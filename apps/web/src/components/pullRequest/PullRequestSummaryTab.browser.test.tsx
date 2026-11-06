import { SourceControlProviderKind } from "@t3tools/contracts";
import { EnvironmentId, ProjectId, type PullRequestDetailView } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  update: vi.fn(),
  setLabels: vi.fn(),
  setAssignees: vi.fn(),
  canUpdate: true,
}));

vi.mock(import("~/state/use-atom-command"), async (original) => {
  const { pullRequestEnvironment } = await import("~/state/pullRequests");
  return {
    ...(await original()),
    useAtomCommand: ((command: unknown) =>
      command === pullRequestEnvironment.setLabels
        ? state.setLabels
        : command === pullRequestEnvironment.setAssignees
          ? state.setAssignees
          : state.update) as never,
  };
});
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock(import("~/state/pullRequests"), async (original) => {
  const actual = await original();
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const allowed = Atom.make(true);
  const denied = Atom.make(false);
  const candidates = Atom.make(
    AsyncResult.success({
      candidates: [
        { name: "bug", color: null, description: null, isApplied: true },
        { name: "docs", color: null, description: null, isApplied: false },
      ],
      truncated: false,
    }),
  );
  const assigneeCandidates = Atom.make(
    AsyncResult.success({
      candidates: [
        { login: "ada", name: null, avatarUrl: null, isAssigned: true },
        { login: "grace", name: null, avatarUrl: null, isAssigned: false },
      ],
      truncated: false,
    }),
  );
  return {
    ...actual,
    pullRequestEnvironment: {
      ...actual.pullRequestEnvironment,
      labelCandidates: (() => candidates) as never,
      assigneeCandidates: (() => assigneeCandidates) as never,
      setAssignees: {
        ...actual.pullRequestEnvironment.setAssignees,
        permissionAtom: () => allowed,
      },
      update: {
        ...actual.pullRequestEnvironment.update,
        permissionAtom: () => (state.canUpdate ? allowed : denied),
      },
    },
  };
});

function setup() {
  state.update.mockReset();
  state.update.mockResolvedValue({ _tag: "Success", value: undefined });
  state.canUpdate = true;
}

import { act, render as renderUi } from "../../../test/render";
import { PullRequestSummaryTab } from "./PullRequestSummaryTab";

const detail: PullRequestDetailView = {
  provider: SourceControlProviderKind.make("github"),
  projectId: ProjectId.make("project"),
  projectTitle: "Project",
  workspaceRoot: "/workspace",
  repository: "owner/repo",
  number: 1,
  title: "Test pull request",
  body: "Original description",
  url: "https://github.com/owner/repo/pull/1",
  author: { login: "author", name: null, avatarUrl: null },
  viewer: "author",
  state: "open",
  isDraft: false,
  mergeability: "mergeable",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  headBranch: "feature",
  baseBranch: "main",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  mergedAt: null,
  closedAt: null,
  reviewers: [],
  labels: [],
  checks: [{ name: "Unit tests", status: "success", description: null, url: null }],
  comments: [],
  commentCount: 0,
  commentsTruncated: false,
  reviewThreads: [],
  commits: [],
  mergeCapabilities: { merge: false, squash: false, rebase: false },
  capabilities: {
    diff: true,
    comment: true,
    search: true,
    actions: [],
    mergeMethods: [],
    review: { inlineComment: false, reply: false, resolve: false, verdicts: [] },
    reviewers: { request: false, listCandidates: false },
    edit: { changeRequest: true, comment: true },
  },
  viewerPermissions: {
    actions: [],
    comment: true,
    resolve: false,
    verdicts: [],
    requestReviewers: false,
  },
};

// The comment filter persists to localStorage, so tests that touch it start and end empty.

const tab = (value = detail) => (
  <PullRequestSummaryTab
    scrollerRef={() => {}}
    environmentId={EnvironmentId.make("environment")}
    threadRef={null}
    reference={value}
    detail={value}
    activityPending={false}
    activityError={null}
    onRefresh={() => {}}
    pullRequestKey="pull-request"
    pendingAction={null}
    perform={async () => false}
    canUnapprove={false}
    active
  />
);

async function render(value = detail) {
  const screen = await renderUi(tab(value));
  const { container } = screen;
  const heading = (title: string) => {
    const section = container.querySelector(`section[aria-label="${title}"]`);
    expect(section, `section ${title}`).not.toBeNull();
    return [...section!.querySelectorAll("button")].find(
      (button) => button.querySelector("span")?.textContent === title,
    )!;
  };
  return Object.assign(screen, {
    click: (title: string) => act(async () => heading(title).click()),
    expanded: (title: string) => heading(title).getAttribute("aria-expanded"),
    visibleText: () => container.innerText,
  });
}

it("keeps an unsaved description when collapsed and reopened, and after a failed save", async () => {
  setup();
  state.update.mockResolvedValue({ _tag: "Failure", cause: new Error("offline") });
  await using screen = await render();
  await act(async () =>
    screen.container.querySelector<HTMLButtonElement>('[aria-label="Edit description"]')!.click(),
  );
  const textarea = screen.container.querySelector("textarea")!;
  await userEvent.clear(textarea);
  await userEvent.type(textarea, "Unsaved description");
  await screen.click("Description");
  expect(screen.expanded("Description")).toBe("false");
  await screen.click("Description");
  expect(screen.container.querySelector("textarea")!.value).toBe("Unsaved description");

  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(state.update).toHaveBeenCalledTimes(1);
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  expect(screen.container.querySelector("textarea")!.value).toBe("Unsaved description");
});

it("ticks a description checkbox placed after an attachment and edits from the ticked body", async () => {
  setup();
  let finishSave = (_result: unknown) => {};
  state.update.mockReturnValueOnce(new Promise((resolve) => (finishSave = resolve)));
  const body = "Intro\n\nhttps://example.com/shot.png\n\n## Test plan\n- [ ] First\n- [ ] Second";
  const ticked = body.replace("- [ ] Second", "- [x] Second");
  await using screen = await render({ ...detail, body, observedAt: 1 });
  const boxes = () => screen.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect([...boxes()].map((box) => box.disabled)).toEqual([false, false]);

  await userEvent.click(boxes()[1]!);
  expect(state.update).toHaveBeenCalledWith({
    environmentId: "environment",
    input: expect.objectContaining({ number: 1, body: ticked }),
  });
  expect([...boxes()].map((box) => box.checked)).toEqual([false, true]);
  await act(async () => finishSave({ _tag: "Success", value: undefined }));

  // The host has not been read since the save, so the editor starts from the ticked body.
  await act(async () =>
    screen.container.querySelector<HTMLButtonElement>('[aria-label="Edit description"]')!.click(),
  );
  expect(screen.container.querySelector("textarea")!.value).toBe(ticked);
});

it("leaves description checkboxes read-only without the right to edit it", async () => {
  setup();
  const body = "- [ ] First";
  {
    await using screen = await render({ ...detail, body, viewer: "someone-else" });
    expect(
      screen.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled,
    ).toBe(true);
  }
  state.canUpdate = false;
  await using screen = await render({ ...detail, body });
  expect(screen.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(
    true,
  );
});

function setupLabels() {
  setup();
  state.setLabels.mockReset();
  state.setLabels.mockResolvedValue({ _tag: "Success", value: undefined });
  return {
    ...detail,
    labels: [{ name: "bug", color: null }],
    capabilities: { ...detail.capabilities, labels: true },
    viewerPermissions: { ...detail.viewerPermissions, labels: true },
  };
}

it("label menu should send nothing when it closes without changes", async () => {
  const value = setupLabels();
  await using screen = await render(value);
  await screen.getByLabelText("Change labels").click();
  await expect.element(page.getByRole("option", { name: /docs/ })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("option", { name: /docs/ })).not.toBeInTheDocument();
  expect(state.setLabels).not.toHaveBeenCalled();
});

it("label menu should send one add and one remove batch on close when labels were toggled while open", async () => {
  const value = setupLabels();
  await using screen = await render(value);
  await screen.getByLabelText("Change labels").click();
  await page.getByRole("option", { name: /docs/ }).click();
  await page.getByRole("option", { name: /bug/ }).click();
  await expect
    .element(page.getByRole("option", { name: /docs/ }).getByLabelText("Applied"))
    .toBeVisible();
  expect(state.setLabels).not.toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(state.setLabels).toHaveBeenCalledTimes(2));
  const reference = {
    projectId: value.projectId,
    repository: value.repository,
    number: value.number,
  };
  expect(state.setLabels.mock.calls).toEqual([
    [
      {
        environmentId: "environment",
        input: expect.objectContaining({ ...reference, labels: ["docs"], applied: true }),
      },
    ],
    [
      {
        environmentId: "environment",
        input: expect.objectContaining({ ...reference, labels: ["bug"], applied: false }),
      },
    ],
  ]);
});

it("assignee picker should close and send one assignment when a candidate is picked on a single-assignee host", async () => {
  setup();
  state.setAssignees.mockReset();
  state.setAssignees.mockResolvedValue({
    _tag: "Success",
    value: { assignees: [{ login: "grace", name: null, avatarUrl: null }] },
  });
  const value: PullRequestDetailView = {
    ...detail,
    assignees: [{ login: "ada", name: null, avatarUrl: null }],
    capabilities: { ...detail.capabilities, assignees: { set: true, multiple: false } },
    viewerPermissions: { ...detail.viewerPermissions, assignees: true },
  };
  await using screen = await render(value);
  await screen.getByLabelText("Assign").click();
  await expect
    .element(page.getByText("GitLab takes one assignee. Picking someone replaces ada."))
    .toBeVisible();
  await page.getByRole("option", { name: /grace/ }).click();
  await expect.element(page.getByRole("option", { name: /grace/ })).not.toBeInTheDocument();
  expect(state.setAssignees).toHaveBeenCalledTimes(1);
  expect(state.setAssignees).toHaveBeenCalledWith({
    environmentId: "environment",
    input: expect.objectContaining({ number: 1, logins: ["grace"], assigned: true }),
  });
});

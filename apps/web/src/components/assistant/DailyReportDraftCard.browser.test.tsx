import {
  AssistantError,
  EnvironmentId,
  type AssistantDailyReportStatus,
  type AssistantDraft,
  type AssistantDraftItem,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { setLanguagePreference } from "~/i18n/languagePreferenceStore";
import { render } from "../../../test/render";

const { atoms, current, commands, saveDraft, submitDailyReport, regenerateDraft, reloadState } =
  vi.hoisted(() => {
    const atoms = {
      state: { atom: "state" },
      report: { atom: "report" },
      projects: { atom: "projects" },
      permission: { atom: "permission" },
    };
    return {
      atoms,
      current: { state: null as unknown, canOperate: true },
      commands: {
        saveDraft: { permissionAtom: () => atoms.permission },
        submitDailyReport: { permissionAtom: () => atoms.permission },
        regenerateDraft: { permissionAtom: () => atoms.permission },
      },
      saveDraft: vi.fn(),
      submitDailyReport: vi.fn(),
      regenerateDraft: vi.fn(),
      reloadState: vi.fn(),
    };
  });
const { toast, dialogs } = vi.hoisted(() => ({ toast: vi.fn(), dialogs: { confirm: vi.fn() } }));

vi.mock(import("@effect/atom-react"), async (original) => {
  const { AsyncResult } = await import("effect/reactivity");
  const report: AssistantDailyReportStatus = {
    reportDate: "2026-11-05",
    exempt: false,
    submittedAt: null,
    erpDailyReportUrl: "https://erp.example.com/daily-reports",
  };
  return {
    ...(await original()),
    useAtomValue: ((atom: unknown) =>
      atom === atoms.state
        ? current.state
        : atom === atoms.report
          ? AsyncResult.success(report)
          : atom === atoms.projects
            ? AsyncResult.success([{ id: 7, name: "Example project" }])
            : current.canOperate) as never,
    useAtomRefresh: ((atom: unknown) => (atom === atoms.state ? reloadState : () => {})) as never,
  };
});
vi.mock(import("../../state/assistant"), () => ({
  assistantEnvironment: {
    state: () => atoms.state,
    dailyReport: () => atoms.report,
    projects: () => atoms.projects,
    ...commands,
  } as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: unknown) =>
    command === commands.saveDraft
      ? saveDraft
      : command === commands.submitDailyReport
        ? submitDailyReport
        : command === commands.regenerateDraft
          ? regenerateDraft
          : vi.fn()) as never,
}));
vi.mock(import("../ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: toast } };
});
vi.mock(import("../../localApi"), async (original) => ({
  ...(await original()),
  ensureLocalApi: () => ({ dialogs }) as never,
}));

import { DailyReportDraftCard } from "./DailyReportDraftCard";

const ENVIRONMENT_ID = EnvironmentId.make("environment-primary");

const item = (
  content: string,
  overrides: Partial<AssistantDraftItem> = {},
): AssistantDraftItem => ({
  section: "today",
  content,
  status: "processing",
  projectId: null,
  projectOther: null,
  sortOrder: 0,
  ...overrides,
});

const readyDraft: AssistantDraft = {
  reportDate: "2026-11-05",
  status: "ready",
  items: [item("Write the release notes")],
  problemText: "",
  revision: 4,
  version: 2,
  sources: [],
  editedByUser: false,
  triggerAttempt: 0,
  updatedAt: "2026-11-05T01:30:00.000Z",
};

function setup(draft: AssistantDraft) {
  current.state = AsyncResult.success({ assistantThreadId: null, drafts: [draft] });
  current.canOperate = true;
  saveDraft.mockReset();
  submitDailyReport.mockReset();
  regenerateDraft.mockReset();
  reloadState.mockReset();
  toast.mockReset();
  dialogs.confirm.mockReset();
}

/** The card's copy is asserted in zh-TW, the Spec's language. */
function zhTW(): Disposable {
  setLanguagePreference("zh-TW");
  return { [Symbol.dispose]: () => setLanguagePreference("system") };
}

function card(
  props: {
    runActive?: boolean;
    input?: { items: AssistantDraftItem[]; problemText: string } | null;
  } = {},
) {
  return (
    <>
      {/* Somewhere outside the card to move focus to. */}
      <button type="button">outside</button>
      <DailyReportDraftCard
        environmentId={ENVIRONMENT_ID}
        reportDate="2026-11-05"
        version={2}
        input={props.input ?? null}
        runActive={props.runActive ?? false}
      />
    </>
  );
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => (resolve = settle));
  return { promise, resolve };
}

const saved = (revision: number, overrides: Partial<AssistantDraft> = {}) =>
  AsyncResult.success({ ...readyDraft, revision, editedByUser: true, ...overrides });
const staleRevision = () =>
  AsyncResult.failure(Cause.fail(new AssistantError({ reason: "stale-revision" })));

describe("DailyReportDraftCard", () => {
  it("DailyReportDraftCard should show 已有新版本 and the first item with the count when superseded", async () => {
    setup({ ...readyDraft, version: 3 });
    using _locale = zhTW();
    await using screen = await render(
      card({
        input: {
          items: [item("Review merge requests"), item("Fix the build"), item("Plan the sprint")],
          problemText: "",
        },
      }),
    );

    await expect.element(screen.getByText("日報草稿 11/05")).toBeVisible();
    await expect.element(screen.getByText("已有新版本")).toBeVisible();
    await expect.element(screen.getByText("Review merge requests")).toBeVisible();
    await expect.element(screen.getByText("…共 3 項")).toBeVisible();
    expect(screen.container.textContent).not.toContain("Fix the build");
    const controls = screen.container.querySelectorAll("button, input, textarea");
    expect([...controls].map((control) => control.textContent)).toEqual(["outside"]);
  });

  it("DailyReportDraftCard should toast and reseed when saveDraft fails with stale-revision", async () => {
    setup(readyDraft);
    using _locale = zhTW();
    saveDraft.mockResolvedValue(staleRevision());
    await using screen = await render(card());
    const content = screen.getByRole("textbox", { name: "內容" });

    await userEvent.fill(content, "Write the release notes today");
    // Tab keeps focus inside the card, so only the stale-revision handling reseeds.
    await userEvent.tab();

    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", title: "草稿已更新，請確認後再送出" }),
      ),
    );
    expect(saveDraft).toHaveBeenCalledExactlyOnceWith({
      environmentId: ENVIRONMENT_ID,
      input: {
        reportDate: "2026-11-05",
        revision: 4,
        items: [item("Write the release notes today")],
        problemText: "",
      },
    });
    expect(reloadState).toHaveBeenCalledOnce();

    current.state = AsyncResult.success({
      assistantThreadId: null,
      drafts: [{ ...readyDraft, revision: 5, items: [item("Updated elsewhere")] }],
    });
    await screen.rerender(card());

    await expect.element(content).toHaveValue("Updated elsewhere");
  });

  it("DailyReportDraftCard should keep the saved edit when the save answers before the state stream catches up", async () => {
    setup(readyDraft);
    using _locale = zhTW();
    saveDraft.mockResolvedValue(saved(5, { items: [item("Write the release notes today")] }));
    submitDailyReport.mockResolvedValue(saved(6, { status: "submitted" }));
    await using screen = await render(card());
    const content = screen.getByRole("textbox", { name: "內容" });

    await userEvent.fill(content, "Write the release notes today");
    await userEvent.click(screen.getByRole("button", { name: "outside" }));
    await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledOnce());
    // The stream still reports revision 4 with the old content.
    await screen.rerender(card());

    await expect.element(content).toHaveValue("Write the release notes today");
    await userEvent.click(screen.getByRole("button", { name: "送出到 ERP", exact: true }));
    await vi.waitFor(() =>
      expect(submitDailyReport).toHaveBeenCalledExactlyOnceWith({
        environmentId: ENVIRONMENT_ID,
        input: { reportDate: "2026-11-05", revision: 5 },
      }),
    );
  });

  it("DailyReportDraftCard should chain queued saves on the returned revision and submit only after they finish when 送出到 ERP is clicked mid-save", async () => {
    setup(readyDraft);
    using _locale = zhTW();
    const firstSave = deferred<ReturnType<typeof saved>>();
    const secondSave = deferred<ReturnType<typeof saved>>();
    saveDraft.mockReturnValueOnce(firstSave.promise).mockReturnValueOnce(secondSave.promise);
    submitDailyReport.mockResolvedValue(saved(7, { status: "submitted" }));
    await using screen = await render(card());

    await userEvent.fill(screen.getByRole("textbox", { name: "內容" }), "Edited");
    await userEvent.tab();
    await userEvent.click(screen.getByRole("button", { name: "新增項目" }).first());
    await userEvent.click(screen.getByRole("button", { name: "送出到 ERP", exact: true }));

    expect(saveDraft).toHaveBeenCalledOnce();
    expect(submitDailyReport).not.toHaveBeenCalled();
    firstSave.resolve(saved(5));
    await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2));
    expect(saveDraft.mock.calls[1]?.[0]).toMatchObject({
      input: {
        revision: 5,
        items: [item("Edited"), item("", { section: "yesterday", status: "new" })],
      },
    });
    expect(submitDailyReport).not.toHaveBeenCalled();

    secondSave.resolve(saved(6));
    await vi.waitFor(() =>
      expect(submitDailyReport).toHaveBeenCalledExactlyOnceWith({
        environmentId: ENVIRONMENT_ID,
        input: { reportDate: "2026-11-05", revision: 6 },
      }),
    );
  });

  it("DailyReportDraftCard should not save the reloaded draft again when the field is left untouched after a stale-revision reseed", async () => {
    setup(readyDraft);
    using _locale = zhTW();
    const firstSave = deferred<ReturnType<typeof staleRevision>>();
    saveDraft.mockReturnValueOnce(firstSave.promise);
    await using screen = await render(card());
    const content = screen.getByRole("textbox", { name: "內容" });

    await userEvent.fill(content, "First edit");
    await userEvent.tab();
    // A second edit is still unsaved in the focused field when the first save is rejected.
    await userEvent.fill(content, "Second edit");
    firstSave.resolve(staleRevision());
    await vi.waitFor(() => expect(reloadState).toHaveBeenCalledOnce());
    current.state = AsyncResult.success({
      assistantThreadId: null,
      drafts: [{ ...readyDraft, revision: 5, items: [item("Updated elsewhere")] }],
    });
    await screen.rerender(card());
    await expect.element(content).toHaveValue("Updated elsewhere");

    await userEvent.tab();

    expect(saveDraft).toHaveBeenCalledOnce();
  });

  it("DailyReportDraftCard should show each item's project when the card is submitted", async () => {
    setup({
      ...readyDraft,
      status: "submitted",
      items: [
        item("Write the release notes", { projectId: 7 }),
        item("Fix the build", { section: "yesterday", projectOther: "Internal tooling" }),
      ],
    });
    using _locale = zhTW();
    await using screen = await render(card());

    await expect.element(screen.getByText("Example project")).toBeVisible();
    await expect.element(screen.getByText("Internal tooling")).toBeVisible();
    await expect.element(screen.getByRole("link", { name: "到 ERP 修改" })).toBeVisible();
  });

  it("DailyReportDraftCard should disable 送出到 ERP when the assistant run is active", async () => {
    setup(readyDraft);
    using _locale = zhTW();
    await using screen = await render(card({ runActive: true }));
    const submit = screen.getByRole("button", { name: "送出到 ERP", exact: true });

    await expect.element(submit).toBeDisabled();
    await screen.rerender(card({ runActive: false }));
    await expect.element(submit).toBeEnabled();
  });

  it("DailyReportDraftCard should disable 送出到 ERP when no item has content", async () => {
    setup({ ...readyDraft, items: [item("  ")] });
    using _locale = zhTW();
    await using screen = await render(card());
    const submit = screen.getByRole("button", { name: "送出到 ERP", exact: true });

    await expect.element(submit).toBeDisabled();
    await userEvent.fill(screen.getByRole("textbox", { name: "內容" }), "Write the release notes");
    await expect.element(submit).toBeEnabled();
  });

  it("DailyReportDraftCard should ask before regenerating when the draft was edited by the user", async () => {
    setup({ ...readyDraft, editedByUser: true });
    using _locale = zhTW();
    regenerateDraft.mockResolvedValue(AsyncResult.success({ ...readyDraft, status: "generating" }));
    await using screen = await render(card());
    const regenerate = screen.getByRole("button", { name: "重新產生", exact: true });

    dialogs.confirm.mockResolvedValueOnce(false);
    await userEvent.click(regenerate);
    await vi.waitFor(() => expect(dialogs.confirm).toHaveBeenCalledOnce());
    expect(dialogs.confirm.mock.calls[0]?.[0]).toBe("重新產生會蓋掉你的修改");
    expect(regenerateDraft).not.toHaveBeenCalled();

    dialogs.confirm.mockResolvedValueOnce(true);
    await userEvent.click(regenerate);
    await vi.waitFor(() => expect(regenerateDraft).toHaveBeenCalledOnce());
    expect(regenerateDraft).toHaveBeenCalledWith({
      environmentId: ENVIRONMENT_ID,
      input: { reportDate: "2026-11-05", revision: 4 },
    });
  });

  it("DailyReportDraftCard should render the source line with ✗ and the note when a source failed", async () => {
    setup({
      ...readyDraft,
      sources: [
        { key: "t3_threads", status: "failed", note: "讀取失敗" },
        { key: "erp_prefill", status: "ok" },
        { key: "calendar", status: "partial" },
      ],
    });
    using _locale = zhTW();
    await using screen = await render(card());

    await expect
      .element(screen.getByText("ERP 預填 ✓・行事曆 ✓・昨天的對話串 ✗ 讀取失敗"))
      .toBeVisible();
  });
});

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
    <DailyReportDraftCard
      environmentId={ENVIRONMENT_ID}
      reportDate="2026-11-05"
      version={2}
      input={props.input ?? null}
      runActive={props.runActive ?? false}
    />
  );
}

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
    expect(screen.container.querySelectorAll("button, input, textarea")).toHaveLength(0);
  });

  it("DailyReportDraftCard should toast and reseed when saveDraft fails with stale-revision", async () => {
    setup(readyDraft);
    using _locale = zhTW();
    saveDraft.mockResolvedValue(
      AsyncResult.failure(Cause.fail(new AssistantError({ reason: "stale-revision" }))),
    );
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

  it("DailyReportDraftCard should disable 送出到 ERP when the assistant run is active", async () => {
    setup(readyDraft);
    using _locale = zhTW();
    await using screen = await render(card({ runActive: true }));
    const submit = screen.getByRole("button", { name: "送出到 ERP", exact: true });

    await expect.element(submit).toBeDisabled();
    await screen.rerender(card({ runActive: false }));
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

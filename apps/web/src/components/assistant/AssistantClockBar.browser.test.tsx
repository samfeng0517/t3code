import {
  AssistantError,
  EnvironmentId,
  ThreadId,
  type AssistantClockStatus,
  type AssistantDailyReportStatus,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { setLanguagePreference } from "~/i18n/languagePreferenceStore";
import { render } from "../../../test/render";

const { state, commands, clockIn, clockOut, regenerateDraft } = vi.hoisted(() => ({
  state: { canOperate: true },
  commands: {
    clockIn: { permissionAtom: () => null },
    clockOut: { permissionAtom: () => null },
    regenerateDraft: { permissionAtom: () => null },
  },
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  regenerateDraft: vi.fn(),
}));

vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => state.canOperate) as never,
}));
vi.mock(import("../../state/assistant"), () => ({
  assistantEnvironment: commands as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: unknown) =>
    command === commands.clockIn
      ? clockIn
      : command === commands.clockOut
        ? clockOut
        : command === commands.regenerateDraft
          ? regenerateDraft
          : vi.fn()) as never,
}));

import { AssistantClockBar } from "./AssistantClockBar";

const ENVIRONMENT_ID = EnvironmentId.make("environment-primary");
const THREAD_ID = ThreadId.make("thread-assistant");

const idleStatus: AssistantClockStatus = {
  reportDate: "2026-11-05",
  serverNow: "2026-11-05T01:00:00.000Z",
  segments: [],
  activeStart: null,
  completedHours: 0,
  requiredHours: 8,
  expectedEnd: null,
};

const workingStatus: AssistantClockStatus = {
  ...idleStatus,
  segments: [{ start: "2026-11-05T01:02:00.000Z", end: null, hours: 0 }],
  activeStart: "2026-11-05T01:02:00.000Z",
  expectedEnd: "2026-11-05T09:02:00.000Z",
};

const report: AssistantDailyReportStatus = {
  reportDate: "2026-11-05",
  exempt: false,
  submittedAt: null,
  erpDailyReportUrl: "https://erp.example.com/daily-reports",
};

function setup() {
  state.canOperate = true;
  clockIn.mockReset();
  clockOut.mockReset();
  regenerateDraft.mockReset();
}

/** The bar's copy is asserted in zh-TW, the Spec's language. */
function zhTW(): Disposable {
  setLanguagePreference("zh-TW");
  return { [Symbol.dispose]: () => setLanguagePreference("system") };
}

function bar(clock: { data: AssistantClockStatus | null; failure: unknown }) {
  return (
    <AssistantClockBar
      environmentId={ENVIRONMENT_ID}
      threadId={THREAD_ID}
      clock={{ ...clock, refresh: () => {} }}
      report={report}
      draft={null}
    />
  );
}

describe("AssistantClockBar", () => {
  it("AssistantClockBar should show only 打卡 and the idle chip when there are no segments", async () => {
    setup();
    using _locale = zhTW();
    await using screen = await render(bar({ data: idleStatus, failure: null }));

    await expect.element(screen.getByRole("button", { name: "打卡", exact: true })).toBeVisible();
    await expect.element(screen.getByText("日報：打卡後會自動擬日報")).toBeVisible();
    expect(screen.container.textContent).not.toContain("停卡");
    expect(screen.container.textContent).not.toContain("預計下班");
  });

  it("AssistantClockBar should call clockOut once when 停卡 is confirmed by a second click within 3 seconds", async () => {
    setup();
    using _locale = zhTW();
    clockOut.mockResolvedValue(AsyncResult.success(idleStatus));
    await using screen = await render(bar({ data: workingStatus, failure: null }));

    await userEvent.click(screen.getByRole("button", { name: "停卡", exact: true }));
    const confirm = screen.getByRole("button", { name: "確定停卡？", exact: true });
    await expect.element(confirm).toBeVisible();
    expect(clockOut).not.toHaveBeenCalled();

    await userEvent.click(confirm);

    expect(clockOut).toHaveBeenCalledExactlyOnceWith({
      environmentId: ENVIRONMENT_ID,
      input: {},
    });
  });

  it("AssistantClockBar should disable the button and ignore clicks while clockIn is pending", async () => {
    setup();
    using _locale = zhTW();
    let resolve: (result: AsyncResult.AsyncResult<AssistantClockStatus>) => void = () => {};
    clockIn.mockReturnValue(new Promise((settle) => (resolve = settle)));
    await using screen = await render(bar({ data: idleStatus, failure: null }));
    // The spinner joins the button's name while pending.
    const button = screen.getByRole("button", { name: /打卡$/ });

    await userEvent.click(button);
    await expect.element(button).toBeDisabled();
    (button.element() as HTMLButtonElement).click();

    expect(clockIn).toHaveBeenCalledOnce();
    resolve(AsyncResult.success(workingStatus));
    await expect.element(screen.getByRole("button", { name: "停卡", exact: true })).toBeEnabled();
  });

  it("AssistantClockBar should show 前往設定 when the status error is not-configured", async () => {
    setup();
    using _locale = zhTW();
    await using screen = await render(
      bar({ data: null, failure: new AssistantError({ reason: "not-configured" }) }),
    );

    await expect.element(screen.getByText("尚未設定 ERP token")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "前往設定" })).toBeVisible();
  });
});

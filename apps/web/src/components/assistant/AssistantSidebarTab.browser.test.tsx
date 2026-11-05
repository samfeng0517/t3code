import {
  EnvironmentId,
  type AssistantClockStatus,
  type EnvironmentId as EnvironmentIdType,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { setLanguagePreference } from "~/i18n/languagePreferenceStore";
import { act, fakeTimers, render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";

const state = vi.hoisted(() => ({
  primaryEnvironmentId: null as EnvironmentIdType | null,
  clock: null as AssistantClockStatus | null,
}));

vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: () => state.primaryEnvironmentId,
}));
vi.mock(import("../../state/assistant"), () => ({
  assistantEnvironment: {
    clockStatus: (() =>
      Atom.make(
        state.clock === null ? AsyncResult.initial() : AsyncResult.success(state.clock),
      )) as never,
  } as never,
}));

import { AssistantSidebarTab } from "./AssistantSidebarTab";

const ENVIRONMENT_ID = EnvironmentId.make("environment-primary");

// 09:02–12:01 done (2:59), then 13:05 onward, in UTC to keep the fixture zone-free.
const working: AssistantClockStatus = {
  reportDate: "2026-11-05",
  serverNow: "2026-11-05T13:05:00.000Z",
  segments: [
    { start: "2026-11-05T09:02:00.000Z", end: "2026-11-05T12:01:00.000Z", hours: 179 / 60 },
    { start: "2026-11-05T13:05:00.000Z", end: null, hours: 0 },
  ],
  activeStart: "2026-11-05T13:05:00.000Z",
  completedHours: 179 / 60,
  requiredHours: 8,
  expectedEnd: "2026-11-05T18:06:00.000Z",
};

function setup(input: {
  readonly primaryEnvironmentId: EnvironmentIdType | null;
  readonly clock: AssistantClockStatus | null;
}) {
  state.primaryEnvironmentId = input.primaryEnvironmentId;
  state.clock = input.clock;
}

/** The tab's copy is asserted in zh-TW, the Spec's language. */
function zhTW(): Disposable {
  setLanguagePreference("zh-TW");
  return { [Symbol.dispose]: () => setLanguagePreference("system") };
}

const tab = () => (
  <SidebarProvider defaultOpen>
    <AssistantSidebarTab />
  </SidebarProvider>
);

describe("AssistantSidebarTab", () => {
  it("AssistantSidebarTab should show 上班中 with worked time when a segment is open", async () => {
    setup({ primaryEnvironmentId: ENVIRONMENT_ID, clock: working });
    using _locale = zhTW();
    using _now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-05T15:18:30.000Z"));
    await using screen = await render(tab());

    await expect.element(screen.getByRole("link", { name: /助理/ })).toBeVisible();
    await expect.element(screen.getByText("上班中 5:12")).toBeVisible();
  });

  it("AssistantSidebarTab should advance the worked time when the next minute starts", async () => {
    setup({ primaryEnvironmentId: ENVIRONMENT_ID, clock: working });
    using _locale = zhTW();
    using _timers = fakeTimers({ now: Date.parse("2026-11-05T15:18:30.000Z") });
    await using screen = await render(tab());
    expect(screen.container.textContent).toContain("上班中 5:12");

    await act(() => vi.advanceTimersByTime(30_000));

    expect(screen.container.textContent).toContain("上班中 5:13");
  });

  it("AssistantSidebarTab should not render when there is no primary environment", async () => {
    setup({ primaryEnvironmentId: null, clock: working });
    using _locale = zhTW();
    await using screen = await render(tab());

    expect(screen.container.textContent).toBe("");
  });
});

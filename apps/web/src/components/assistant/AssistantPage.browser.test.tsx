import { AssistantError, EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { setLanguagePreference } from "~/i18n/languagePreferenceStore";
import { render } from "../../../test/render";

const { commands, getOrCreateThread } = vi.hoisted(() => ({
  commands: {
    clockStatus: () => "clock-atom",
    dailyReport: () => "report-atom",
    state: () => "state-atom",
    getOrCreateThread: { permissionAtom: () => "permission-atom" },
  },
  getOrCreateThread: vi.fn(),
}));

vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: ((atom: unknown) =>
    atom === "state-atom"
      ? AsyncResult.success({ assistantThreadId: null, drafts: [] })
      : true) as never,
}));
vi.mock(import("../../state/assistant"), () => ({
  assistantEnvironment: commands as never,
  refreshSettled: vi.fn(),
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: () => EnvironmentId.make("environment-primary"),
}));
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({ data: null, failure: null, refresh: vi.fn() })) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => getOrCreateThread) as never,
}));
vi.mock(import("../ChatView"), () => ({ default: (() => null) as never }));
vi.mock(import("./AssistantClockBar"), () => ({ AssistantClockBar: (() => null) as never }));

import { AssistantPage } from "./AssistantPage";

/** The page's copy is asserted in zh-TW, the Spec's language. */
function zhTW(): Disposable {
  setLanguagePreference("zh-TW");
  return { [Symbol.dispose]: () => setLanguagePreference("system") };
}

describe("AssistantPage", () => {
  it("AssistantPage should show the unavailable message and ask again on retry when creating the assistant thread fails", async () => {
    getOrCreateThread
      .mockReset()
      .mockResolvedValue(
        AsyncResult.failure(Cause.fail(new AssistantError({ reason: "thread-unavailable" }))),
      );
    using _locale = zhTW();
    await using screen = await render(<AssistantPage />);

    await expect.element(screen.getByText("助理聊天室目前無法使用")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "重試" }));

    await vi.waitFor(() => expect(getOrCreateThread).toHaveBeenCalledTimes(2));
  });
});

import {
  AssistantError,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  SETTINGS_SECRET_REDACTED,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { setLanguagePreference } from "~/i18n/languagePreferenceStore";
import { render } from "../../../test/render";

const ENVIRONMENT_ID = EnvironmentId.make("environment-primary");

const { state, commands, updateSettings, readMemory, writeMemory } = vi.hoisted(() => ({
  state: { erpBaseUrl: "", erpToken: "" },
  commands: {
    readMemory: { label: "environment-data:assistant:read-memory", permissionAtom: () => null },
    writeMemory: { label: "environment-data:assistant:write-memory", permissionAtom: () => null },
  },
  updateSettings: vi.fn(),
  readMemory: vi.fn(),
  writeMemory: vi.fn(),
}));

const allowed = Atom.make(true);
commands.readMemory.permissionAtom = (() => allowed) as never;
commands.writeMemory.permissionAtom = (() => allowed) as never;

vi.mock(import("../../state/assistant"), () => ({ assistantEnvironment: commands as never }));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: () => ENVIRONMENT_ID,
  useEnvironmentProviders: () => new Map(),
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
}));
vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: ((_id: unknown, selector?: (settings: unknown) => unknown) => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      assistant: { ...DEFAULT_SERVER_SETTINGS.assistant, ...state },
    };
    return selector ? selector(settings) : settings;
  }) as never,
  useUpdateEnvironmentSettings: () => vi.fn(),
}));
vi.mock(import("../chat/ProviderModelPicker"), () => ({
  ProviderModelPicker: (() => null) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: { readonly label: string }) =>
    command.label === commands.readMemory.label
      ? readMemory
      : command.label === commands.writeMemory.label
        ? writeMemory
        : updateSettings) as never,
}));

import { AssistantSettingsPanel } from "./AssistantSettings";

function setup(saved: { readonly erpBaseUrl: string; readonly erpToken: string }) {
  state.erpBaseUrl = saved.erpBaseUrl;
  state.erpToken = saved.erpToken;
  updateSettings.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  readMemory.mockReset();
  writeMemory.mockReset();
}

/** The page's copy is asserted in zh-TW, the Spec's language. */
function zhTW(): Disposable {
  setLanguagePreference("zh-TW");
  return { [Symbol.dispose]: () => setLanguagePreference("system") };
}

describe("AssistantSettings", () => {
  it("AssistantSettings should send erpToken empty when the ERP URL changes and no new token was typed", async () => {
    setup({ erpBaseUrl: "https://erp.example.com", erpToken: SETTINGS_SECRET_REDACTED });
    using _locale = zhTW();
    await using screen = await render(<AssistantSettingsPanel />);

    const url = screen.getByRole("textbox", { name: "ERP 網址" });
    await userEvent.clear(url);
    await userEvent.type(url, "https://erp-next.example.com");
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));

    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
      environmentId: ENVIRONMENT_ID,
      input: {
        patch: { assistant: { erpBaseUrl: "https://erp-next.example.com", erpToken: "" } },
      },
    });
  });

  it("AssistantSettings should show the https message and not save when the ERP URL is not https", async () => {
    setup({ erpBaseUrl: "https://erp.example.com", erpToken: SETTINGS_SECRET_REDACTED });
    using _locale = zhTW();
    await using screen = await render(<AssistantSettingsPanel />);

    const url = screen.getByRole("textbox", { name: "ERP 網址" });
    await userEvent.clear(url);
    await userEvent.type(url, "http://erp.example.com");
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));

    await expect.element(screen.getByText("ERP 網址要用 https:// 開頭")).toBeVisible();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("AssistantSettings should show the missing URL message and not save when a token is typed without an ERP URL", async () => {
    setup({ erpBaseUrl: "", erpToken: "" });
    using _locale = zhTW();
    await using screen = await render(<AssistantSettingsPanel />);

    await userEvent.type(screen.getByRole("textbox", { name: "ERP token" }), "token-value");
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));

    await expect.element(screen.getByText("請先填 ERP 網址")).toBeVisible();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("AssistantSettings should load the memory and call writeMemory with the edited text when saved", async () => {
    setup({ erpBaseUrl: "https://erp.example.com", erpToken: SETTINGS_SECRET_REDACTED });
    using _locale = zhTW();
    readMemory.mockResolvedValue(AsyncResult.success({ content: "# 助理記憶\n" }));
    writeMemory.mockResolvedValue(AsyncResult.success(undefined));
    await using screen = await render(<AssistantSettingsPanel />);

    await userEvent.click(screen.getByRole("button", { name: "編輯助理記憶" }));
    const editor = page.getByRole("dialog").getByRole("textbox");
    await expect.element(editor).toHaveValue("# 助理記憶\n");
    await userEvent.fill(editor, "日報用條列");
    await userEvent.click(page.getByRole("dialog").getByRole("button", { name: "儲存" }));

    expect(readMemory).toHaveBeenCalledExactlyOnceWith({
      environmentId: ENVIRONMENT_ID,
      input: {},
    });
    expect(writeMemory).toHaveBeenCalledExactlyOnceWith({
      environmentId: ENVIRONMENT_ID,
      input: { content: "日報用條列" },
    });
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("AssistantSettings should keep the dialog open with the edited text when writeMemory fails with memory-io", async () => {
    setup({ erpBaseUrl: "https://erp.example.com", erpToken: SETTINGS_SECRET_REDACTED });
    using _locale = zhTW();
    readMemory.mockResolvedValue(AsyncResult.success({ content: "# 助理記憶\n" }));
    writeMemory.mockResolvedValue(
      AsyncResult.failure(Cause.fail(new AssistantError({ reason: "memory-io" }))),
    );
    await using screen = await render(<AssistantSettingsPanel />);

    await userEvent.click(screen.getByRole("button", { name: "編輯助理記憶" }));
    const editor = page.getByRole("dialog").getByRole("textbox");
    await expect.element(editor).toHaveValue("# 助理記憶\n");
    await userEvent.fill(editor, "日報用條列");
    await userEvent.click(page.getByRole("dialog").getByRole("button", { name: "儲存" }));

    await expect.element(page.getByText("助理記憶存不進去，你的修改還在視窗裡")).toBeVisible();
    await expect.element(editor).toHaveValue("日報用條列");
  });

  it("AssistantSettings should show the read failure in the dialog when readMemory fails with memory-io", async () => {
    setup({ erpBaseUrl: "https://erp.example.com", erpToken: SETTINGS_SECRET_REDACTED });
    using _locale = zhTW();
    readMemory.mockResolvedValue(
      AsyncResult.failure(Cause.fail(new AssistantError({ reason: "memory-io" }))),
    );
    await using screen = await render(<AssistantSettingsPanel />);

    await userEvent.click(screen.getByRole("button", { name: "編輯助理記憶" }));

    await expect
      .element(page.getByRole("dialog").getByText("讀不到助理記憶，請稍後再試"))
      .toBeVisible();
    await expect
      .element(page.getByRole("dialog").getByRole("button", { name: "儲存" }))
      .toBeDisabled();
  });
});

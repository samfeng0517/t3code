import type { BrowserExtensionStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { MessageKey } from "~/i18n";
import { en } from "~/i18n/messages/en";
import { formatMessage } from "~/i18n/locale";

import {
  browserExtensionImportToast,
  browserExtensionMutationToast,
  browserExtensionProblemText,
  browserExtensionUpdateToast,
  isBrowserExtensionCopied,
} from "./browserExtensions.logic";

const t = (key: MessageKey, params?: Parameters<typeof formatMessage>[1]) =>
  formatMessage(en[key], params);

const status = (overrides: Partial<BrowserExtensionStatus> = {}): BrowserExtensionStatus => ({
  path: "/ext/a",
  enabled: true,
  name: "Example",
  version: "1.0.0",
  manifestVersion: 3,
  problem: null,
  detail: null,
  ...overrides,
});

describe("browserExtensionMutationToast", () => {
  it("explains a refused add", () => {
    expect(
      browserExtensionMutationToast({ extensions: [], refusal: "missingManifest" }, "/ext/a", t),
    ).toEqual({
      type: "error",
      title: "Could not add extension",
      description: "No manifest.json in this folder.",
    });
    expect(
      browserExtensionMutationToast({ extensions: [], refusal: "limitReached" }, "/ext/a", t)
        ?.description,
    ).toBe("You can add up to 32 extensions.");
  });

  it("reports a browser load failure for the extension just touched", () => {
    const failed = status({ problem: "loadFailed", detail: "Unsupported manifest key" });
    expect(
      browserExtensionMutationToast(
        { extensions: [failed, status({ path: "/ext/b" })], refusal: null },
        "/ext/a",
        t,
      ),
    ).toEqual({
      type: "error",
      title: "Example could not be loaded",
      description: "Could not load: Unsupported manifest key",
    });
  });

  it("stays silent for clean changes, disabled entries, and other entries' problems", () => {
    const failedOther = status({ path: "/ext/b", problem: "loadFailed", detail: "x" });
    expect(
      browserExtensionMutationToast(
        { extensions: [status(), failedOther], refusal: null },
        "/ext/a",
        t,
      ),
    ).toBeNull();
    expect(
      browserExtensionMutationToast(
        { extensions: [status({ enabled: false, problem: "missingManifest" })], refusal: null },
        "/ext/a",
        t,
      ),
    ).toBeNull();
  });
});

describe("browserExtensionProblemText", () => {
  it("names each problem", () => {
    expect(browserExtensionProblemText(status(), t)).toBeNull();
    expect(browserExtensionProblemText(status({ problem: "invalidManifest" }), t)).toBe(
      "manifest.json is not a valid Manifest V2 or V3 file.",
    );
  });
});

const chromeCopy = status({
  path: "/copies/chrome/Default/abc",
  problem: "sourceMissing",
  source: {
    sourceId: "chrome",
    sourceName: "Chrome",
    profileDirectory: "Default",
    profileName: "Person 1",
    extensionId: "abcdefghijklmnopabcdefghijklmnop",
  },
});

describe("copied browser extensions", () => {
  it("browserExtensionProblemText should name the browser when the source no longer has the extension", () => {
    expect(browserExtensionProblemText(chromeCopy, t)).toBe(
      "Chrome no longer has this extension; keeping this version.",
    );
  });

  it("browserExtensionMutationToast should stay silent when the touched copy only lost its source", () => {
    expect(
      browserExtensionMutationToast(
        { extensions: [chromeCopy], refusal: null },
        chromeCopy.path,
        t,
      ),
    ).toBeNull();
  });

  it("browserExtensionMutationToast should stay silent when the touched copy only failed to update", () => {
    expect(
      browserExtensionMutationToast(
        {
          extensions: [{ ...chromeCopy, problem: "updateFailed", detail: "EACCES" }],
          refusal: null,
        },
        chromeCopy.path,
        t,
      ),
    ).toBeNull();
  });

  it("isBrowserExtensionCopied should match a copy from any profile when checking an extension id", () => {
    expect(isBrowserExtensionCopied([chromeCopy], "abcdefghijklmnopabcdefghijklmnop")).toBe(true);
    expect(isBrowserExtensionCopied([chromeCopy], "ponmlkjihgfedcbaponmlkjihgfedcba")).toBe(false);
  });

  it("browserExtensionImportToast should explain a copy that failed when the import is refused", () => {
    expect(
      browserExtensionImportToast({ extensions: [], refusal: "copyFailed" }, [], t)?.description,
    ).toBe("Some extensions could not be copied. Try again later.");
  });

  it("browserExtensionImportToast should report a load failure when a just-copied extension was rejected", () => {
    const rejected = { ...chromeCopy, problem: "loadFailed" as const, detail: "Bad key" };
    expect(
      browserExtensionImportToast(
        { extensions: [rejected], refusal: null },
        ["abcdefghijklmnopabcdefghijklmnop"],
        t,
      )?.description,
    ).toBe("Could not load: Bad key");
    expect(
      browserExtensionImportToast({ extensions: [rejected], refusal: null }, [], t),
    ).toBeNull();
  });
});

describe("browserExtensionUpdateToast", () => {
  const updated = (
    list: Array<{ name: string; version: string }>,
    extensions: Array<BrowserExtensionStatus> = [],
  ) => ({ updated: list, extensions });

  it("should name the extension and its new version when one extension updated", () => {
    expect(
      browserExtensionUpdateToast(updated([{ name: "Ptt", version: "7.2.2" }]), false, t),
    ).toEqual({ type: "success", title: "Updated Ptt to 7.2.2. Reload tabs to apply." });
  });

  it("should count the extensions when several updated", () => {
    expect(
      browserExtensionUpdateToast(
        updated([
          { name: "A", version: "1" },
          { name: "B", version: "2" },
        ]),
        false,
        t,
      )?.title,
    ).toBe("Updated 2 extensions. Reload tabs to apply.");
  });

  it("should report up to date only when the user asked and nothing changed", () => {
    expect(browserExtensionUpdateToast(updated([]), true, t)?.title).toBe(
      "Extensions are up to date",
    );
    expect(browserExtensionUpdateToast(updated([]), false, t)).toBeNull();
  });

  it("should report the failed copy instead of up to date when the user asked and an update failed", () => {
    const failed = { ...chromeCopy, problem: "updateFailed" as const, detail: "EACCES" };
    expect(browserExtensionUpdateToast(updated([], [failed]), true, t)).toEqual({
      type: "error",
      title: "Could not update Example",
      description: "Could not copy the newer version; keeping this one: EACCES",
    });
    expect(browserExtensionUpdateToast(updated([], [failed]), false, t)).toBeNull();
  });
});

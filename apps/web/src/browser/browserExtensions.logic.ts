import {
  BROWSER_EXTENSION_MAX_COUNT,
  type BrowserExtensionMutationResult,
  type BrowserExtensionStatus,
  type BrowserExtensionUpdateResult,
} from "@t3tools/contracts";

import type { Translate } from "~/i18n";

export function browserExtensionName(status: BrowserExtensionStatus, t: Translate): string {
  return status.name ?? t("browser.extensions.unknownName");
}

export function browserExtensionProblemText(
  status: BrowserExtensionStatus,
  t: Translate,
): string | null {
  switch (status.problem) {
    case null:
      return null;
    case "missingManifest":
      return t("browser.extensions.problem.missingManifest");
    case "invalidManifest":
      return t("browser.extensions.problem.invalidManifest");
    case "loadFailed":
      return t("browser.extensions.problem.loadFailed", { detail: status.detail ?? "" });
    case "sourceMissing":
      return t("browser.extensions.problem.sourceMissing", {
        browser: status.source?.sourceName ?? "",
      });
    case "updateFailed":
      return t("browser.extensions.problem.updateFailed", { detail: status.detail ?? "" });
  }
}

/**
 * Whether an extension is already copied in, from any browser profile: copies of one extension
 * share its id, so a second copy could not run beside the first.
 */
export function isBrowserExtensionCopied(
  extensions: ReadonlyArray<BrowserExtensionStatus>,
  extensionId: string,
): boolean {
  return extensions.some(({ source }) => source?.extensionId === extensionId);
}

/**
 * Silent when nothing changed, unless the user asked and should hear it is up to date or why
 * an update did not land. Automatic runs leave failures to the settings list.
 */
export function browserExtensionUpdateToast(
  result: BrowserExtensionUpdateResult,
  manual: boolean,
  t: Translate,
): BrowserExtensionToast | null {
  const { updated } = result;
  const [only] = updated;
  if (only === undefined) {
    if (!manual) return null;
    const failed = result.extensions.find((status) => status.problem === "updateFailed");
    if (failed === undefined) {
      return { type: "success", title: t("browser.extensions.update.upToDate") };
    }
    const description = browserExtensionProblemText(failed, t);
    return {
      type: "error",
      title: t("browser.extensions.update.failed", { name: browserExtensionName(failed, t) }),
      ...(description === null ? {} : { description }),
    };
  }
  if (updated.length === 1) {
    return {
      type: "success",
      title: t("browser.extensions.update.done", { name: only.name, version: only.version }),
    };
  }
  return {
    type: "success",
    title: t("browser.extensions.update.doneMany", { count: updated.length }),
  };
}

export interface BrowserExtensionToast {
  readonly type: "success" | "error";
  readonly title: string;
  readonly description?: string;
}

function refusalToast(
  refusal: BrowserExtensionMutationResult["refusal"],
  t: Translate,
): BrowserExtensionToast | null {
  switch (refusal) {
    case "missingManifest":
    case "invalidManifest":
      return {
        type: "error",
        title: t("browser.extensions.addFailed"),
        description: t(`browser.extensions.problem.${refusal}`),
      };
    case "alreadyAdded":
    case "copyFailed":
      return {
        type: "error",
        title: t("browser.extensions.addFailed"),
        description: t(`browser.extensions.refusal.${refusal}`),
      };
    case "limitReached":
      return {
        type: "error",
        title: t("browser.extensions.addFailed"),
        description: t("browser.extensions.refusal.limitReached", {
          count: BROWSER_EXTENSION_MAX_COUNT,
        }),
      };
    case null:
      return null;
  }
}

// A lost source or a failed update predates the action and shows in the list instead.
function loadFailureToast(
  touched: BrowserExtensionStatus | undefined,
  t: Translate,
): BrowserExtensionToast | null {
  if (
    !touched?.enabled ||
    touched.problem === null ||
    touched.problem === "sourceMissing" ||
    touched.problem === "updateFailed"
  ) {
    return null;
  }
  const description = browserExtensionProblemText(touched, t);
  return {
    type: "error",
    title: t("browser.extensions.loadFailed", { name: browserExtensionName(touched, t) }),
    ...(description === null ? {} : { description }),
  };
}

/**
 * The toast an add or enable owes the user: a refusal, or a load the browser
 * rejected for the extension that was just touched. Silent otherwise.
 */
export function browserExtensionMutationToast(
  result: BrowserExtensionMutationResult,
  path: string,
  t: Translate,
): BrowserExtensionToast | null {
  return (
    refusalToast(result.refusal, t) ??
    loadFailureToast(
      result.extensions.find((status) => status.path === path),
      t,
    )
  );
}

/** Like an add, for extensions just copied in from another browser. */
export function browserExtensionImportToast(
  result: BrowserExtensionMutationResult,
  extensionIds: ReadonlyArray<string>,
  t: Translate,
): BrowserExtensionToast | null {
  return (
    refusalToast(result.refusal, t) ??
    loadFailureToast(
      result.extensions.find(
        (status) =>
          status.source !== undefined &&
          extensionIds.includes(status.source.extensionId) &&
          status.problem !== null,
      ),
      t,
    )
  );
}

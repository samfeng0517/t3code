import type { LinkedPrompt } from "@t3tools/shared/promptLinks";

import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";

import { toastManager } from "../ui/toast";
import { t } from "../../i18n";

export function warnAboutHiddenCharacters(prompt: LinkedPrompt): void {
  if (prompt.hiddenCharacters === 0) return;
  toastManager.add({
    type: "warning",
    title: t("onboarding.promptLink.hiddenCharacters.title"),
    description: t(
      prompt.hiddenCharacters === 1
        ? "onboarding.promptLink.hiddenCharacters.description.one"
        : "onboarding.promptLink.hiddenCharacters.description.other",
      { count: prompt.hiddenCharacters },
    ),
    timeout: 0,
  });
}

export function placeLinkedPrompt(
  target: ComposerThreadTarget,
  prompt: LinkedPrompt,
  notes: ReadonlyArray<string> = [],
): void {
  warnAboutHiddenCharacters(prompt);
  const place = () => {
    useComposerDraftStore.getState().setPrompt(target, prompt.text);
    toastManager.add({
      type: "info",
      title: t("onboarding.promptLink.added.title"),
      description: [t("onboarding.promptLink.added.readFirst"), ...notes].join(" "),
    });
  };
  const existing = useComposerDraftStore.getState().getComposerDraft(target)?.prompt ?? "";
  if (existing.trim().length === 0 || existing === prompt.text) {
    place();
    return;
  }
  const id = toastManager.add({
    type: "info",
    title: t("onboarding.promptLink.ready.title"),
    description: t("onboarding.promptLink.ready.description"),
    timeout: 0,
    actionProps: {
      children: t("onboarding.promptLink.replaceDraft"),
      onClick: () => {
        toastManager.close(id);
        place();
      },
    },
  });
}

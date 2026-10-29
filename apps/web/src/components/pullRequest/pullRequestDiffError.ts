import { t as globalT, type Translate } from "~/i18n";

/** Diff failures currently include transport wrappers, so recognize the reason inside them. */
export function describePullRequestDiffError(
  error: string,
  providerName: string,
  term: string,
  t: Translate = globalT,
) {
  if (/\brate limit\b|\brate[-_]limited\b|\btoo many requests\b/i.test(error)) {
    return {
      title: t("pullRequestDetail.diffError.rateLimitTitle", { providerName }),
      description: t("pullRequestDetail.diffError.rateLimitDescription", { providerName }),
    };
  }

  return {
    title: t("pullRequestDetail.diffError.loadFailedTitle"),
    description: t("pullRequestDetail.diffError.loadFailedDescription", { term, providerName }),
  };
}

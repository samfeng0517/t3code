import type { ChangeRequestTerminology } from "@t3tools/client-runtime/source-control-clients";

import { t as globalT, type Translate } from "~/i18n";

export function offHeadPullRequestCheckoutToast(
  terminology: ChangeRequestTerminology,
  t: Translate = globalT,
) {
  return {
    type: "warning",
    title: t("pullRequestDetail.checkoutToast.title"),
    description: t("pullRequestDetail.checkoutToast.description", {
      singular: terminology.singular,
    }),
  } as const;
}

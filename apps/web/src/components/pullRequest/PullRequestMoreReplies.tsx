import { useT } from "~/i18n";

import type { PullRequestReplyAvailability } from "./pullRequestDetail.logic";

export function PullRequestMoreReplies({
  moreReplies,
  hasMoreReplies,
  url,
}: PullRequestReplyAvailability) {
  const t = useT();
  if (!hasMoreReplies) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-2 py-1 text-xs text-muted-foreground">
      <span>
        {moreReplies > 0
          ? t(
              moreReplies === 1
                ? "pullRequestDetail.moreReplies.one"
                : "pullRequestDetail.moreReplies.other",
              { count: moreReplies.toLocaleString() },
            )
          : t("pullRequestDetail.moreReplies.unknown")}
      </span>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground hover:underline"
        >
          {t("pullRequestDetail.moreReplies.viewOnHost")}
        </a>
      ) : null}
    </div>
  );
}

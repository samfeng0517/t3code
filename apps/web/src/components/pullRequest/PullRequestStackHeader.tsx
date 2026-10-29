import { useT, type MessageKey } from "~/i18n";
import { MenuGroupLabel } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function PullRequestStackHeader({
  number,
  notice,
  stale = false,
}: {
  number: number;
  notice?: MessageKey | null | undefined;
  stale?: boolean;
}) {
  const t = useT();
  return (
    <MenuGroupLabel>
      <div className="flex items-center justify-between gap-2">
        <span>{t("pullRequestDetail.stack.header", { number })}</span>
        {notice ? (
          <Tooltip>
            <TooltipTrigger render={<span role="status" className="text-xs font-normal" />}>
              {stale
                ? t("pullRequestDetail.stack.mayBeStale")
                : t("pullRequestDetail.stack.refreshing")}
            </TooltipTrigger>
            <TooltipPopup>{t(notice)}</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
    </MenuGroupLabel>
  );
}

import type { ServerProcessSignal } from "@t3tools/contracts";

import { useT } from "~/i18n";
import { InlineButton } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ProcessSignalActions({
  disabled,
  onSignal,
}: {
  disabled: boolean;
  onSignal: (signal: ServerProcessSignal) => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <InlineButton
              disabled={disabled}
              aria-label={t("settingsProviders.processSignal.send", { signal: "SIGINT" })}
              tone="muted"
              onClick={() => onSignal("SIGINT")}
            >
              INT
            </InlineButton>
          }
        />
        <TooltipPopup side="top">
          {t("settingsProviders.processSignal.send", { signal: "SIGINT" })}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <InlineButton
              disabled={disabled}
              aria-label={t("settingsProviders.processSignal.send", { signal: "SIGKILL" })}
              tone="destructive"
              onClick={() => onSignal("SIGKILL")}
            >
              KILL
            </InlineButton>
          }
        />
        <TooltipPopup side="top">
          {t("settingsProviders.processSignal.send", { signal: "SIGKILL" })}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

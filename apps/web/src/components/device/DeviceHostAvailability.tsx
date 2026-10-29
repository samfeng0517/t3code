import type { DevicePlatformAvailability } from "@t3tools/contracts";
import { Check, Minus } from "lucide-react";
import { useT } from "~/i18n";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

export function DeviceHostAvailability({
  platforms,
}: {
  platforms: ReadonlyArray<DevicePlatformAvailability>;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {platforms.map((platform) => (
        <Tooltip key={platform.platform}>
          <TooltipTrigger render={<span tabIndex={0} className="inline-flex items-center gap-1" />}>
            {platform.available ? <Check className="size-3" /> : <Minus className="size-3" />}
            {platform.available
              ? t("device.availability.available", {
                  platform: platform.platform === "ios" ? "iOS" : "Android",
                })
              : t("device.availability.unavailable", {
                  platform: platform.platform === "ios" ? "iOS" : "Android",
                })}
          </TooltipTrigger>
          <TooltipPopup>
            {platform.reason ??
              t("device.availability.available", {
                platform: platform.platform === "ios" ? "iOS" : "Android",
              })}
          </TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}

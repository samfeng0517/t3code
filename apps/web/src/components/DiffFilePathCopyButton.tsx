import { Check, Copy } from "lucide";
import { useRef } from "react";
import { useT } from "~/i18n";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { cn } from "../lib/utils";
import {
  ANCHORED_COPY_TOAST_TIMEOUT_MS,
  showAnchoredCopyErrorToast,
  showAnchoredCopySuccessToast,
} from "./ui/anchoredCopyToast";
import { Button } from "./ui/button";
import { MorphIcon } from "~/components/MorphIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function DiffFilePathCopyButton({ filePath }: { filePath: string }) {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onCopy: () => showAnchoredCopySuccessToast(ref),
    onError: (error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            size="icon-micro"
            variant="ghost-muted"
            aria-label={t("files.diffPath.copyLabel")}
            onClick={() => copyToClipboard(filePath, undefined)}
          />
        }
      >
        <MorphIcon
          className={cn("size-3", isCopied && "text-success")}
          icon={isCopied ? Check : Copy}
        />
      </TooltipTrigger>
      <TooltipPopup>
        <p>{isCopied ? t("workspace.file.copied") : t("files.diffPath.copyPath")}</p>
      </TooltipPopup>
    </Tooltip>
  );
}

import type { BrowserMediaDevice, BrowserMediaPermission } from "@t3tools/contracts";
import { Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { previewBridge } from "~/components/preview/previewBridge";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useT } from "~/i18n";
import { cn } from "~/lib/utils";

const permissionsBridge = previewBridge?.mediaPermissions ?? null;

export function BrowserMediaPermissionsSetting({ disabled }: { readonly disabled: boolean }) {
  const t = useT();
  const [choices, setChoices] = useState<ReadonlyArray<BrowserMediaPermission>>([]);
  const [pending, setPending] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the remembered choices from the desktop bridge on mount, an external fetch
  useEffect(() => {
    void permissionsBridge
      ?.list()
      .then(setChoices)
      .catch(() => {});
  }, []);

  const remove = async (origin: string, device: BrowserMediaDevice) => {
    if (!permissionsBridge) return;
    setPending(true);
    try {
      setChoices(await permissionsBridge.remove(origin, device));
    } catch (error) {
      toastManager.add({
        type: "error",
        title: t("browser.media.removeFailed"),
        description: error instanceof Error ? error.message : String(error),
      });
    }
    setPending(false);
  };

  return (
    <SettingsRow
      id="browser-media-permissions"
      title={t("browser.media.title")}
      description={t("browser.media.description")}
    >
      {choices.length > 0 ? (
        <div className="mt-2 mb-2 overflow-hidden rounded-lg border border-border/60">
          {choices.map((choice, index) => (
            <div
              key={`${choice.origin}:${choice.device}`}
              className={cn(
                "flex items-center gap-3 px-3 py-2",
                index > 0 && "border-t border-border/60",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {choice.origin}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {choice.device === "camera"
                  ? t("browser.media.camera")
                  : t("browser.media.microphone")}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {choice.decision === "allow"
                  ? t("browser.notifications.allowed")
                  : t("browser.notifications.blocked")}
              </span>
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={
                  choice.device === "camera"
                    ? t("browser.media.removeCameraAria", { origin: choice.origin })
                    : t("browser.media.removeMicrophoneAria", { origin: choice.origin })
                }
                disabled={disabled || pending}
                onClick={() => void remove(choice.origin, choice.device)}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </SettingsRow>
  );
}

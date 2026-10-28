import type { BrowserNotificationPermission } from "@t3tools/contracts";
import { Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { previewBridge } from "~/components/preview/previewBridge";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useT } from "~/i18n";
import { cn } from "~/lib/utils";

const permissionsBridge = previewBridge?.notificationPermissions ?? null;

export function BrowserNotificationPermissionsSetting({
  disabled,
}: {
  readonly disabled: boolean;
}) {
  const t = useT();
  const [sites, setSites] = useState<ReadonlyArray<BrowserNotificationPermission>>([]);
  const [pending, setPending] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the remembered sites from the desktop bridge on mount, an external fetch
  useEffect(() => {
    void permissionsBridge
      ?.list()
      .then(setSites)
      .catch(() => {});
  }, []);

  const remove = async (origin: string) => {
    if (!permissionsBridge) return;
    setPending(true);
    try {
      setSites(await permissionsBridge.remove(origin));
    } catch (error) {
      toastManager.add({
        type: "error",
        title: t("browser.notifications.removeFailed"),
        description: error instanceof Error ? error.message : String(error),
      });
    }
    setPending(false);
  };

  return (
    <SettingsRow
      id="browser-notifications"
      title={t("browser.notifications.title")}
      description={t("browser.notifications.description")}
    >
      {sites.length > 0 ? (
        <div className="mt-2 mb-2 overflow-hidden rounded-lg border border-border/60">
          {sites.map((site, index) => (
            <div
              key={site.origin}
              className={cn(
                "flex items-center gap-3 px-3 py-2",
                index > 0 && "border-t border-border/60",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{site.origin}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {site.decision === "allow"
                  ? t("browser.notifications.allowed")
                  : t("browser.notifications.blocked")}
              </span>
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={t("browser.notifications.removeAria", { origin: site.origin })}
                disabled={disabled || pending}
                onClick={() => void remove(site.origin)}
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

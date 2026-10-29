import type { ReactNode } from "react";
import type { DeviceToolVersions as ToolVersions } from "@t3tools/contracts";
import { useT } from "~/i18n";
import { InlineButton } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";

export function DeviceToolVersions({
  tools,
  action,
  kind,
  owner,
  error,
}: {
  tools: ToolVersions | undefined;
  action?: ReactNode;
  kind?: keyof ToolVersions;
  owner?: string | undefined;
  error?: string | undefined;
}) {
  const t = useT();
  const selected = kind ? tools?.[kind] : undefined;
  const version =
    selected?.runningVersion ??
    (selected?.installedVersions.includes(selected.requiredVersion)
      ? selected.requiredVersion
      : selected?.installedVersions
          .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .at(-1));
  const label = kind === "hub" ? t("device.versions.hub") : t("device.versions.agent");
  return (
    <Popover>
      <PopoverTrigger
        aria-label={
          kind
            ? version
              ? t("device.versions.ariaVersion", { label, version })
              : selected
                ? t("device.versions.ariaNotInstalled", { label })
                : t("device.versions.ariaUnknown", { label })
            : undefined
        }
        render={<InlineButton tone="muted" />}
      >
        {kind
          ? version
            ? `v${version}`
            : selected
              ? t("device.versions.notInstalled")
              : t("device.versions.unknown")
          : error
            ? t("device.versions.unavailable")
            : t("device.versions.versions")}
      </PopoverTrigger>
      <PopoverPopup align="end" width="md">
        <PopoverTitle>{kind ? label : t("device.versions.tools")}</PopoverTitle>
        {tools ? (
          <div className="mt-4 divide-y divide-border/50">
            {(
              [
                [t("device.versions.hub"), tools.hub],
                [t("device.versions.agent"), tools.agent],
              ] as const
            )
              .filter(([name]) => !kind || name === label)
              .map(([name, tool]) => (
                <div key={name} className="space-y-2 py-3 first:pt-0 last:pb-0">
                  {!kind ? <p className="text-xs font-medium">{name}</p> : null}
                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">{t("device.versions.running")}</dt>
                    <dd className="text-right font-mono">
                      {tool.runningVersion ?? t("device.versions.notRunning")}
                    </dd>
                    <dt className="text-muted-foreground">{t("device.versions.required")}</dt>
                    <dd className="text-right font-mono">{tool.requiredVersion}</dd>
                    <dt className="text-muted-foreground">{t("device.versions.installed")}</dt>
                    <dd className="text-right font-mono break-words">
                      {tool.installedVersions.join(", ") || t("device.versions.none")}
                    </dd>
                  </dl>
                </div>
              ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">{t("device.versions.notChecked")}</p>
        )}
        <p className="mt-4 border-t border-border/50 pt-3 text-xs text-muted-foreground">
          {owner ? t("device.versions.managedBy", { owner }) : t("device.versions.autoUpdate")}
        </p>
        {error ? (
          <p role="status" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </PopoverPopup>
    </Popover>
  );
}

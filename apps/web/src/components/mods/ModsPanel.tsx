import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { useT } from "~/i18n";
import { useServerConfigs } from "~/state/entities";
import { modEnvironment } from "~/state/mods";
import { useEnvironmentQuery } from "~/state/query";

import { ModSite } from "./ModUiTree";
import { modsPanelBody } from "./modsPanel.logic";
import { useModActions } from "./useModActions";

/** True when the environment serves mod drawings; older servers never send any. */
export function useModSurfacesSupported(environmentId: EnvironmentId): boolean {
  return useServerConfigs().get(environmentId)?.environment.capabilities.modSurfaces === true;
}

/** The panes Claude Code mods opened in this thread's session, beside the chat. */
export default function ModsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** False while the right panel is closed: a pane's autofocus waits until it shows. */
  readonly visible: boolean;
}) {
  const t = useT();
  const supported = useModSurfacesSupported(props.environmentId);
  const { data } = useEnvironmentQuery(
    supported
      ? modEnvironment.surface({
          environmentId: props.environmentId,
          input: { threadId: props.threadId },
        })
      : null,
  );
  const actions = useModActions(props.environmentId, props.threadId);
  const body = modsPanelBody(supported, data);

  if (body.kind !== "panes" || data === null) {
    const message =
      body.kind === "server-unsupported"
        ? t("mods.panel.serverUnsupported")
        : body.kind === "unsupported"
          ? t("mods.panel.unsupported")
          : body.kind === "inactive"
            ? t("mods.panel.inactive")
            : body.kind === "empty"
              ? t("mods.panel.empty")
              : null;
    if (message === null) return null;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-sm">
        <p>{message}</p>
        {body.kind === "empty" ? (
          <p className="text-muted-foreground text-xs">{t("mods.panel.emptyHint")}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 text-sm">
      {data.panes.map((pane) => (
        <section key={pane.id} className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
          <header className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate font-medium">{pane.title}</h3>
              <p className="truncate text-muted-foreground text-xs">
                {t("mods.panel.from", { plugin: pane.plugin })}
              </p>
            </div>
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={t("mods.panel.closePane", { title: pane.title })}
              disabled={!actions.canAct}
              onClick={() => void actions.closePane(pane.id)}
            >
              <XIcon />
            </Button>
          </header>
          {pane.tree === null ? (
            <p className="text-muted-foreground text-xs">{t("mods.panel.notDrawn")}</p>
          ) : (
            <ModSite
              node={pane.tree}
              site={{ component: "Pane", paneId: pane.id }}
              actions={actions}
              visible={props.visible}
            />
          )}
        </section>
      ))}
    </div>
  );
}

import { RegistryContext } from "@effect/atom-react";
import { lastRaisedModToast } from "@t3tools/client-runtime/state/mods";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useContext, useEffect } from "react";

import { toastManager } from "~/components/ui/toast";
import { useT } from "~/i18n";
import { modEnvironment } from "~/state/mods";
import { useEnvironmentQuery } from "~/state/query";

import { ModSite } from "./ModUiTree";
import { hasModsBand, unseenModToasts } from "./modsPanel.logic";
import { useModSurfacesSupported } from "./ModsPanel";
import { useModActions } from "./useModActions";

/**
 * What mods draw above the prompt: their band and status lines. It also raises
 * their toasts, so it stays mounted while the thread is on screen.
 */
export function ModsStatusBand(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
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
  const registry = useContext(RegistryContext);
  const toasts = data?.toasts;
  const { environmentId, threadId } = props;

  // oxlint-disable-next-line t3code/react-effect-budget -- raises toasts through the external toast manager and records them in the registry, a side effect outside render
  useEffect(() => {
    if (toasts === undefined) return;
    // Kept outside this view, so mounting it again does not raise kept toasts twice.
    const lastRaised = lastRaisedModToast(environmentId, threadId);
    const lastRaisedId = registry.get(lastRaised);
    for (const toast of unseenModToasts(toasts, lastRaisedId)) {
      toastManager.add({
        type: "info",
        title: toast.plugin,
        description: toast.text,
        timeout: toast.timeoutMs,
      });
    }
    registry.set(lastRaised, toasts.at(-1)?.id ?? lastRaisedId);
  }, [registry, environmentId, threadId, toasts]);

  if (!hasModsBand(data) || data === null) return null;
  return (
    <div
      aria-label={t("mods.band.label")}
      className="mx-auto mb-2 flex w-full max-w-3xl flex-col gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm"
    >
      {data.band === null ? null : (
        <ModSite node={data.band} site={{ component: "AbovePrompt" }} actions={actions} visible />
      )}
      {data.statuses.map((line) => (
        <p key={line.plugin} className="truncate text-muted-foreground text-xs">
          <span className="font-medium">{line.plugin}</span> {line.text}
        </p>
      ))}
    </div>
  );
}

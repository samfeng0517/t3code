import { type EnvironmentId, sessionGrantsScope } from "@t3tools/contracts";
import { AUTH_SCOPE_OPTIONS } from "@t3tools/shared/authScopeOptions";
import { useT } from "~/i18n";
import { useEnvironmentSessionState } from "~/state/session";

export function SessionPermissions({
  environmentId,
  connected,
  routeContext = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
  readonly routeContext?: boolean;
}) {
  const t = useT();
  const session = useEnvironmentSessionState(environmentId);
  return connected && !session.hasError && !session.isPending && session.data?.authenticated ? (
    <div className="space-y-3 py-3 text-xs">
      <p className="text-muted-foreground">
        {routeContext
          ? t("settingsMisc.session.routeContext")
          : t("settingsMisc.session.currentConnection")}
      </p>
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {AUTH_SCOPE_OPTIONS.map(({ scope, title }) => (
          <li key={scope} className="flex items-start justify-between gap-3">
            <span>{title}</span>
            <span className="shrink-0 text-muted-foreground">
              {sessionGrantsScope(session.data!, scope)
                ? t("settingsMisc.session.allowed")
                : t("settingsMisc.session.notGranted")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  ) : (
    <p className="py-3 text-xs text-muted-foreground">{t("settingsMisc.session.notChecked")}</p>
  );
}

import type { BrowserMediaDevice } from "@t3tools/contracts";

type QueryMediaState = (device: BrowserMediaDevice) => Promise<unknown>;

interface PermissionGlobals {
  readonly Permissions?: { readonly prototype: Permissions };
  readonly PermissionStatus?: { readonly prototype: PermissionStatus };
}

const deviceFor = (name: unknown): BrowserMediaDevice | null =>
  name === "camera" ? "camera" : name === "microphone" ? "microphone" : null;

/**
 * Electron reports "denied" for camera and microphone nobody has decided on, so sites that
 * query first (Meet) never call getUserMedia. Undecided devices read as "prompt" instead.
 */
export function installMediaPermissionQuery(
  queryMediaState: QueryMediaState,
  globals: PermissionGlobals = globalThis,
): void {
  const permissions = globals.Permissions?.prototype;
  const nativeState = globals.PermissionStatus
    ? Object.getOwnPropertyDescriptor(globals.PermissionStatus.prototype, "state")?.get
    : undefined;
  if (permissions === undefined || nativeState === undefined) return;
  const nativeQuery = permissions.query;
  const query = async function query(this: Permissions, descriptor: PermissionDescriptor) {
    const status = await nativeQuery.call(this, descriptor);
    const device = deviceFor(descriptor?.name);
    if (device === null || nativeState.call(status) !== "denied") return status;
    const state = await queryMediaState(device).catch(() => "denied");
    if (state !== "prompt") return status;
    Object.defineProperty(status, "state", {
      configurable: true,
      get: () => {
        const current: unknown = nativeState.call(status);
        return current === "denied" ? "prompt" : current;
      },
    });
    return status;
  };
  // Bot checks such as Turnstile flag API functions whose source is not native code.
  query.toString = () => Function.prototype.toString.call(nativeQuery);
  permissions.query = query;
}

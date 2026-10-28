import * as NodeModule from "node:module";
import * as NodeNet from "node:net";

import type * as Undici from "undici";

// undici is external to the CLI bundle; Node single-executables can load it from disk only with require.
const requireUndici = NodeModule.createRequire(import.meta.url);

/** Node 26 bundles h2-capable undici 8; Node 22/24 and Electron stay on HTTP/1.1 with 6/7. */
export const builtinFetchUsesHttp2 = (bundledUndiciVersion: string | undefined) =>
  Number.parseInt(bundledUndiciVersion ?? "", 10) >= 8;

/** Preserves the EnvHttpProxyAgent installed by --use-env-proxy / NODE_USE_ENV_PROXY. */
export function installHttp1FetchDispatcher(): void {
  const undici = requireUndici("undici") as typeof Undici;
  // Node's agent comes from its internal undici copy, so `instanceof` against the npm class is false.
  const usesEnvProxy = undici.getGlobalDispatcher().constructor.name === "EnvHttpProxyAgent";
  undici.setGlobalDispatcher(
    usesEnvProxy
      ? new undici.EnvHttpProxyAgent({
          allowH2: false,
          // ProxyAgent's connector forces h2 and ignores allowH2; replace it for HTTPS proxies.
          clientFactory: (origin) => new undici.Pool(origin, { allowH2: false }),
        })
      : new undici.Agent({ allowH2: false }),
  );
}

/** Avoids uncaught idle-timeout errors on h2 streams (https://github.com/nodejs/undici/issues/5936). */
export function keepOutboundFetchOnHttp1(): void {
  if (builtinFetchUsesHttp2(process.versions.undici)) installHttp1FetchDispatcher();
}

const BROTLI_CVE = "CVE-2026-111497";

// The first release of each supported line whose Brotli decoder has the fix.
// Odd and pre-22 majors are end-of-life and never get it.
const BROTLI_FIXED_RELEASES: Readonly<Record<number, readonly [minor: number, patch: number]>> = {
  22: [23, 4],
  24: [22, 1],
  26: [12, 1],
};

// Prerelease and nightly builds are treated as unfixed: they may predate the release.
export function nodeHasBrotliDecoderFix(nodeVersion: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion);
  if (match === null) return false;
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  if (major > 26) return true;
  const fixed = BROTLI_FIXED_RELEASES[major];
  if (fixed === undefined) return false;
  const [fixedMinor, fixedPatch] = fixed;
  return minor > fixedMinor || (minor === fixedMinor && patch >= fixedPatch);
}

export class BrotliResponseRejectedError extends Error {
  override readonly name = "BrotliResponseRejectedError";

  constructor(origin: string) {
    super(
      `Refused a Brotli-encoded response from ${origin}: the Brotli decoder in Node.js ${process.versions.node} is vulnerable to ${BROTLI_CVE}.`,
    );
  }
}

const isBrotliCoding = (coding: string) => /^\s*br\s*(?:;|$)/i.test(coding);

const headerValueText = (value: unknown) =>
  (Array.isArray(value) ? value : [value])
    .filter((part) => part !== undefined && part !== null)
    .map(String)
    .join(", ");

const withoutBrotliCoding = (acceptEncoding: string) => {
  const codings = acceptEncoding
    .split(",")
    .map((coding) => coding.trim())
    .filter((coding) => coding !== "" && !isBrotliCoding(coding));
  return codings.length > 0 ? codings.join(", ") : "identity";
};

type DispatchHeaders = Undici.Dispatcher.DispatchOptions["headers"];

const headerEntries = (
  headers: NonNullable<DispatchHeaders>,
): Array<readonly [string, unknown]> => {
  if (Array.isArray(headers)) {
    const entries: Array<readonly [string, unknown]> = [];
    for (let index = 0; index < headers.length; index += 2) {
      entries.push([String(headers[index]), headers[index + 1]]);
    }
    return entries;
  }
  return Symbol.iterator in headers
    ? Array.from(headers as Iterable<readonly [unknown, unknown]>, ([name, value]) => [
        String(name),
        value,
      ])
    : Object.entries(headers);
};

// A missing Accept-Encoding becomes `identity`, not `gzip, deflate`: fetch always
// sends one, so only raw dispatcher callers get here, and they do not decode bodies.
export function withoutBrotliAcceptEncoding(
  headers: DispatchHeaders,
): NonNullable<DispatchHeaders> {
  const entries = headers == null ? [] : headerEntries(headers);
  const isAcceptEncoding = ([name]: readonly [string, unknown]) =>
    name.toLowerCase() === "accept-encoding";
  const acceptEncoding = entries.filter(isAcceptEncoding);
  const rewritten = [
    ...entries.filter((entry) => !isAcceptEncoding(entry)),
    [
      acceptEncoding[0]?.[0] ?? "accept-encoding",
      acceptEncoding.length === 0
        ? "identity"
        : withoutBrotliCoding(acceptEncoding.map(([, value]) => headerValueText(value)).join(", ")),
    ] as const,
  ];
  // Plain objects stay objects; arrays and other iterables take undici's flat
  // raw form, as its redirect handler does.
  return headers != null && (Array.isArray(headers) || Symbol.iterator in headers)
    ? (rewritten.flatMap(([name, value]) => [name, value]) as Array<string>)
    : (Object.fromEntries(rewritten) as Record<string, string>);
}

const hasBrotliContentEncoding = (contentEncoding: string | Array<string> | undefined) =>
  headerValueText(contentEncoding).split(",").some(isBrotliCoding);

type ResponseHeaders = Parameters<
  NonNullable<Undici.Dispatcher.DispatchHandler["onResponseStart"]>
>[2];

class BrotliGuardHandler implements Undici.Dispatcher.DispatchHandler {
  readonly #handler: Undici.Dispatcher.DispatchHandler;
  readonly #origin: string;

  constructor(handler: Undici.Dispatcher.DispatchHandler, origin: string) {
    this.#handler = handler;
    this.#origin = origin;
  }

  onRequestStart(controller: Undici.Dispatcher.DispatchController, context: unknown) {
    this.#handler.onRequestStart?.(controller, context);
  }

  onRequestUpgrade(
    ...args: Parameters<NonNullable<Undici.Dispatcher.DispatchHandler["onRequestUpgrade"]>>
  ) {
    this.#handler.onRequestUpgrade?.(...args);
  }

  onResponseStart(
    controller: Undici.Dispatcher.DispatchController,
    statusCode: number,
    headers: ResponseHeaders,
    statusMessage?: string,
  ) {
    // Withholding the headers keeps fetch from creating its Brotli decoder; the
    // abort reaches the caller through onResponseError instead.
    if (hasBrotliContentEncoding(headers["content-encoding"])) {
      controller.abort(new BrotliResponseRejectedError(this.#origin));
      return;
    }
    this.#handler.onResponseStart?.(controller, statusCode, headers, statusMessage);
  }

  onResponseData(controller: Undici.Dispatcher.DispatchController, chunk: Buffer) {
    this.#handler.onResponseData?.(controller, chunk);
  }

  onResponseEnd(controller: Undici.Dispatcher.DispatchController, trailers: ResponseHeaders) {
    this.#handler.onResponseEnd?.(controller, trailers);
  }

  onResponseError(controller: Undici.Dispatcher.DispatchController, error: Error) {
    this.#handler.onResponseError?.(controller, error);
  }

  onResponseStarted() {
    this.#handler.onResponseStarted?.();
  }

  onBodySent(chunk: Buffer) {
    this.#handler.onBodySent?.(chunk);
  }

  onRequestSent() {
    this.#handler.onRequestSent?.();
  }
}

const brotliGuardInterceptor: Undici.Dispatcher.DispatcherComposeInterceptor =
  (dispatch) => (options, handler) =>
    options.upgrade
      ? dispatch(options, handler)
      : dispatch(
          { ...options, headers: withoutBrotliAcceptEncoding(options.headers) },
          new BrotliGuardHandler(handler, String(options.origin)),
        );

const GLOBAL_DISPATCHER = Symbol.for("undici.globalDispatcher.2");
const LEGACY_GLOBAL_DISPATCHER = Symbol.for("undici.globalDispatcher.1");

/**
 * Electron bundles a Node whose Brotli decoder is open to CVE-2026-111497 (RCE),
 * and fetch() feeds it whatever a server sends as `Content-Encoding: br`. Until
 * the runtime ships the fix, fetch neither offers nor accepts Brotli. Must run
 * after every other `setGlobalDispatcher` so it wraps the final dispatcher.
 */
export function rejectBrotliResponsesOnVulnerableNode(nodeVersion = process.versions.node): void {
  if (nodeHasBrotliDecoderFix(nodeVersion)) return;
  // Node 22's built-in undici 6 registers its dispatcher only under the legacy key,
  // and loading npm undici then overwrites it with a plain Agent. Read it first so
  // a `--use-env-proxy` agent is not silently dropped.
  const hadDispatcher = Object.hasOwn(globalThis, GLOBAL_DISPATCHER);
  const legacyDispatcher: { constructor?: { name?: string } } | undefined = Reflect.get(
    globalThis,
    LEGACY_GLOBAL_DISPATCHER,
  );
  const undici = requireUndici("undici") as typeof Undici;
  const dispatcher =
    !hadDispatcher && legacyDispatcher?.constructor?.name === "EnvHttpProxyAgent"
      ? // Node 22's built-in agent tunnels plain-http requests through CONNECT too;
        // undici 8 would otherwise forward them in absolute form.
        new undici.EnvHttpProxyAgent({ proxyTunnel: true })
      : undici.getGlobalDispatcher();
  undici.setGlobalDispatcher(dispatcher.compose(brotliGuardInterceptor));
}

// @types/node does not declare setTypeOfService yet.
type TypeOfServiceSocket = {
  setTypeOfService?: (this: NodeNet.Socket, typeOfService: number) => NodeNet.Socket;
};

// Bundled undici calls this from a socket callback without catching. On macOS,
// EINVAL after a peer reset must not exit the server over an optional QoS hint.
export function ignoreMacosTypeOfServiceEinval(
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Runs before ACP dispatch without loading the Effect graph.
  platform = process.platform,
  socketPrototype: TypeOfServiceSocket = NodeNet.Socket.prototype as TypeOfServiceSocket,
): void {
  if (platform !== "darwin") return;
  const setTypeOfService = socketPrototype.setTypeOfService;
  if (typeof setTypeOfService !== "function") return;
  socketPrototype.setTypeOfService = function (...args) {
    try {
      return setTypeOfService.apply(this, args);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EINVAL") return this;
      throw error;
    }
  };
}

/**
 * Node's 250 ms Happy Eyeballs attempt timeout abandons a working-but-slow IPv4
 * connect when IPv6 is advertised but unroutable, which broke the ACP registry
 * fetch. A larger `--network-family-autoselection-attempt-timeout` still wins.
 */
export function extendConnectionAttemptTimeout(): void {
  NodeNet.setDefaultAutoSelectFamilyAttemptTimeout(
    Math.max(NodeNet.getDefaultAutoSelectFamilyAttemptTimeout(), 1_000),
  );
}

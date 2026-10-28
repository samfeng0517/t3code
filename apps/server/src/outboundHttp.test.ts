// @effect-diagnostics nodeBuiltinImport:off - the tests run real HTTP servers to see what fetch negotiates and decodes.
import * as NodeHttp from "node:http";
import * as NodeHttp2 from "node:http2";
import * as NodeNet from "node:net";
import * as NodeTls from "node:tls";
import * as NodeZlib from "node:zlib";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { FetchHttpClient, HttpClient } from "effect/http";
import * as Undici from "undici";
import { afterAll, afterEach, beforeAll, describe, expect } from "vite-plus/test";

import {
  BrotliResponseRejectedError,
  builtinFetchUsesHttp2,
  ignoreMacosTypeOfServiceEinval,
  installHttp1FetchDispatcher,
  nodeHasBrotliDecoderFix,
  rejectBrotliResponsesOnVulnerableNode,
  withoutBrotliAcceptEncoding,
} from "./outboundHttp.ts";

// Non-secret, self-signed 127.0.0.1 certificate, valid until 2126; ALPN h2 requires TLS.
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg3EwCztQysKTvzdcR
g0LWq+axzUd4tHi9PyMdqh7PlGShRANCAARfQpoLgv/tOsHWCLriDza7Ruaey2b7
mR/nS6mLu6W7+agkEqDm0mE3F/ngpPjL4Jj0IGadeMcKNKFRSBgiLdfn
-----END PRIVATE KEY-----
`;
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBsDCCAVagAwIBAgIUWbn2Wt5kTxii1UU57NJMt/wTaUgwCgYIKoZIzj0EAwIw
JDEiMCAGA1UEAwwZdDNjb2RlIG91dGJvdW5kIGh0dHAgdGVzdDAgFw0yNjEwMTEy
MjQyMzZaGA8yMTI2MDkxNzIyNDIzNlowJDEiMCAGA1UEAwwZdDNjb2RlIG91dGJv
dW5kIGh0dHAgdGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABF9CmguC/+06
wdYIuuIPNrtG5p7LZvuZH+dLqYu7pbv5qCQSoObSYTcX+eCk+MvgmPQgZp14xwo0
oVFIGCIt1+ejZDBiMB0GA1UdDgQWBBSsekAc30Q/zdIE/tvVDQKJL5oiCDAfBgNV
HSMEGDAWgBSsekAc30Q/zdIE/tvVDQKJL5oiCDAPBgNVHRMBAf8EBTADAQH/MA8G
A1UdEQQIMAaHBH8AAAEwCgYIKoZIzj0EAwIDSAAwRQIgebUrkyP56242EJB7nCV7
A+Ke/q0rNPya3fjQa9O5B+kCIQC1SfmdNaFcNJ4JINlus4FfrRnfKiADS2MIJR9f
99BN0A==
-----END CERTIFICATE-----
`;

const server = NodeHttp2.createSecureServer(
  { allowHTTP1: true, key: TEST_KEY, cert: TEST_CERT },
  (request, response) => response.end(request.httpVersion),
);
let origin = "";
const defaultCaCertificates = NodeTls.getCACertificates("default");
const defaultDispatcher = Undici.getGlobalDispatcher();
const defaultAttemptTimeout = NodeNet.getDefaultAutoSelectFamilyAttemptTimeout();

beforeAll(async () => {
  NodeTls.setDefaultCACertificates([...defaultCaCertificates, TEST_CERT]);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `https://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}/`;
});

afterEach(() => {
  Undici.setGlobalDispatcher(defaultDispatcher);
  NodeNet.setDefaultAutoSelectFamilyAttemptTimeout(defaultAttemptTimeout);
});

afterAll(async () => {
  NodeTls.setDefaultCACertificates(defaultCaCertificates);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const versionViaGlobalDispatcher = async () => (await Undici.request(origin)).body.text();

const versionViaBuiltinFetch = () =>
  HttpClient.get(origin).pipe(
    Effect.flatMap((response) => response.text),
    Effect.provide(FetchHttpClient.layer),
  );

describe("installHttp1FetchDispatcher", () => {
  it("makes the global dispatcher negotiate HTTP/1.1 and keeps the env proxy agent", async () => {
    Undici.setGlobalDispatcher(new Undici.Agent());
    expect(await versionViaGlobalDispatcher()).toBe("2.0");

    installHttp1FetchDispatcher();
    expect(await versionViaGlobalDispatcher()).toBe("1.1");

    Undici.setGlobalDispatcher(new Undici.EnvHttpProxyAgent());
    installHttp1FetchDispatcher();
    expect(Undici.getGlobalDispatcher()).toBeInstanceOf(Undici.EnvHttpProxyAgent);
  });

  // Only bundled undici 8 (Node 26+) offers fetch h2 and can prove dispatcher replacement.
  it.effect.runIf(builtinFetchUsesHttp2(process.versions.undici))(
    "moves the built-in fetch off HTTP/2",
    () =>
      Effect.gen(function* () {
        expect(yield* versionViaBuiltinFetch()).toBe("2.0");
        installHttp1FetchDispatcher();
        expect(yield* versionViaBuiltinFetch()).toBe("1.1");
      }),
  );
});

const runNode = Effect.fnUntraced(function* (args: Array<string>, env?: Record<string, string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make(process.execPath, args, env ? { env, extendEnv: true } : {}),
  );
  return yield* Effect.all(
    {
      stdout: child.stdout.pipe(Stream.decodeText(), Stream.mkString),
      stderr: child.stderr.pipe(Stream.decodeText(), Stream.mkString),
      exitCode: child.exitCode.pipe(Effect.map(Number)),
    },
    { concurrency: "unbounded" },
  );
}, Effect.scoped);

describe("ignoreMacosTypeOfServiceEinval", () => {
  const errnoError = (code: string) =>
    Object.assign(new Error(`setTypeOfService ${code}`), { code, syscall: "setTypeOfService" });

  it("swallows only an Error with code EINVAL on macOS", () => {
    let error: unknown = errnoError("EINVAL");
    const prototype = {
      setTypeOfService(this: NodeNet.Socket, _typeOfService: number): NodeNet.Socket {
        throw error;
      },
    };
    ignoreMacosTypeOfServiceEinval("darwin", prototype);

    const socket = new NodeNet.Socket();
    expect(prototype.setTypeOfService.call(socket, 0)).toBe(socket);

    error = errnoError("EPERM");
    expect(() => prototype.setTypeOfService.call(socket, 0)).toThrow(error);

    error = { code: "EINVAL" };
    expect(() => prototype.setTypeOfService.call(socket, 0)).toThrow();
  });

  // Bundled undici 7 calls this API from a socket callback. Keep the real fetch
  // in a child so an escaped EINVAL exits that process instead of breaking Vitest.
  it.effect.runIf(
    typeof (NodeNet.Socket.prototype as { setTypeOfService?: unknown }).setTypeOfService ===
      "function" && process.versions.undici?.startsWith("7.") === true,
  )("keeps built-in fetch working when setTypeOfService throws EINVAL", () =>
    Effect.gen(function* () {
      const child = yield* runNode([
        "--input-type=module",
        "--eval",
        `
import * as NodeNet from "node:net";
import * as NodeTls from "node:tls";
import { ignoreMacosTypeOfServiceEinval } from ${JSON.stringify(new URL("./outboundHttp.ts", import.meta.url).href)};

NodeTls.setDefaultCACertificates([${JSON.stringify(TEST_CERT)}]);
let calls = 0;
NodeNet.Socket.prototype.setTypeOfService = () => {
  calls++;
  throw Object.assign(new Error("setTypeOfService EINVAL"), { code: "EINVAL" });
};
ignoreMacosTypeOfServiceEinval("darwin");
console.log(await (await fetch(${JSON.stringify(origin)})).text());
if (calls === 0) throw new Error("fetch did not call setTypeOfService");
`,
      ]);
      expect(child.exitCode, child.stderr).toBe(0);
      expect(child.stdout.trim()).toBe("1.1");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("nodeHasBrotliDecoderFix", () => {
  it.each([
    ["22.23.4", true],
    ["v22.23.4", true],
    ["22.24.0", true],
    ["24.22.1", true],
    ["24.23.0", true],
    ["26.12.1", true],
    ["27.0.0", true],
    ["22.23.3", false],
    ["22.22.9", false],
    ["24.22.0", false],
    ["24.13.1", false],
    ["26.12.0", false],
    ["23.99.0", false],
    ["25.9.9", false],
    ["20.99.0", false],
    ["", false],
    ["24.22.1-nightly", false],
    ["24.22.1-pre", false],
    [" 24.22.1", false],
    ["24.22", false],
  ])("%s -> %s", (version, fixed) => {
    expect(nodeHasBrotliDecoderFix(version)).toBe(fixed);
  });
});

describe("withoutBrotliAcceptEncoding", () => {
  it("drops br from fetch's defaults and keeps other headers", () => {
    expect(
      withoutBrotliAcceptEncoding({ "accept-encoding": "gzip, deflate, br, zstd", accept: "*/*" }),
    ).toEqual({ accept: "*/*", "accept-encoding": "gzip, deflate, zstd" });
    expect(withoutBrotliAcceptEncoding({ "accept-encoding": "br, gzip, deflate" })).toEqual({
      "accept-encoding": "gzip, deflate",
    });
  });

  it("matches the header name and coding case-insensitively and merges repeats", () => {
    expect(
      withoutBrotliAcceptEncoding({ "Accept-Encoding": ["BR;q=1.0", "gzip"], "x-trace": "1" }),
    ).toEqual({ "x-trace": "1", "Accept-Encoding": "gzip" });
    expect(
      withoutBrotliAcceptEncoding([
        "Accept-Encoding",
        "br",
        "x-trace",
        "1",
        "accept-encoding",
        "zstd",
      ]),
    ).toEqual(["x-trace", "1", "Accept-Encoding", "zstd"]);
  });

  it("flattens iterables into undici's raw array form", () => {
    expect(
      withoutBrotliAcceptEncoding(
        new Map([
          ["accept-encoding", "br"],
          ["x-trace", "1"],
        ]),
      ),
    ).toEqual(["x-trace", "1", "accept-encoding", "identity"]);
  });

  it("asks for identity when nothing but br was accepted or no header was sent", () => {
    expect(withoutBrotliAcceptEncoding({ "accept-encoding": "br" })).toEqual({
      "accept-encoding": "identity",
    });
    expect(withoutBrotliAcceptEncoding(undefined)).toEqual({ "accept-encoding": "identity" });
    expect(withoutBrotliAcceptEncoding(["x-trace", "1"])).toEqual([
      "x-trace",
      "1",
      "accept-encoding",
      "identity",
    ]);
  });
});

describe("rejectBrotliResponsesOnVulnerableNode", () => {
  const RESPONSE_TEXT = "decoded response";
  const encoders: Record<string, (body: Buffer) => Buffer> = {
    br: (body) => NodeZlib.brotliCompressSync(body),
    gzip: (body) => NodeZlib.gzipSync(body),
  };
  // `/<codings>` replies with the body encoded by each coding in order and echoes
  // the request's Accept-Encoding in `x-accept-encoding`.
  const encodingServer = NodeHttp.createServer((request, response) => {
    const codings = decodeURIComponent(request.url!.slice(1)).split(",");
    const body = codings.reduce<Buffer>(
      (encoded, coding) => encoders[coding.trim().toLowerCase()]!(encoded),
      Buffer.from(RESPONSE_TEXT),
    );
    response.writeHead(200, {
      "content-encoding": codings.join(", "),
      "x-accept-encoding": request.headers["accept-encoding"] ?? "",
    });
    response.end(body);
  });
  let encodingOrigin = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => encodingServer.listen(0, "127.0.0.1", resolve));
    encodingOrigin = `http://127.0.0.1:${(encodingServer.address() as NodeNet.AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => encodingServer.close(() => resolve()));
  });

  const getViaBuiltinFetch = (codings: string, headers?: Record<string, string>) =>
    HttpClient.get(`${encodingOrigin}/${codings}`, headers ? { headers } : undefined).pipe(
      Effect.flatMap((response) =>
        Effect.map(response.text, (text) => ({
          text,
          sentAcceptEncoding: response.headers["x-accept-encoding"],
        })),
      ),
      Effect.provide(FetchHttpClient.layer),
    );

  const causeChain = (error: unknown): Array<unknown> =>
    error instanceof Object && "cause" in error ? [error, ...causeChain(error.cause)] : [error];

  const brotliErrorViaGlobalDispatcher = Effect.promise(() =>
    Undici.request(`${encodingOrigin}/br`).then(
      (response): unknown => response,
      (error: unknown) => error,
    ),
  );

  it.live("makes the built-in fetch reject Brotli before decoding it", () =>
    Effect.gen(function* () {
      expect((yield* getViaBuiltinFetch("br")).text).toBe(RESPONSE_TEXT);

      rejectBrotliResponsesOnVulnerableNode("24.22.0");

      for (const codings of ["br", "BR", "gzip,br"]) {
        const error = yield* Effect.flip(getViaBuiltinFetch(codings));
        expect(causeChain(error)).toContainEqual(expect.any(BrotliResponseRejectedError));
      }
    }),
  );

  it.live("keeps gzip responses decoding and stops offering br", () =>
    Effect.gen(function* () {
      rejectBrotliResponsesOnVulnerableNode("24.22.0");

      expect(
        yield* getViaBuiltinFetch("gzip", { "accept-encoding": "gzip, deflate, br, zstd" }),
      ).toEqual({ text: RESPONSE_TEXT, sentAcceptEncoding: "gzip, deflate, zstd" });

      const raw = yield* Effect.promise(() => Undici.request(`${encodingOrigin}/gzip`));
      yield* Effect.promise(() => raw.body.dump());
      expect(raw.headers["x-accept-encoding"]).toBe("identity");
    }),
  );

  it("is a no-op on a fixed Node", () => {
    const dispatcher = Undici.getGlobalDispatcher();
    rejectBrotliResponsesOnVulnerableNode("24.22.1");
    expect(Undici.getGlobalDispatcher()).toBe(dispatcher);
  });

  it.live("wraps the HTTP/1.1 and env proxy dispatchers installed before it", () =>
    Effect.gen(function* () {
      Undici.setGlobalDispatcher(new Undici.Agent());
      installHttp1FetchDispatcher();
      rejectBrotliResponsesOnVulnerableNode("24.22.0");
      expect(yield* Effect.promise(versionViaGlobalDispatcher)).toBe("1.1");
      expect(yield* brotliErrorViaGlobalDispatcher).toBeInstanceOf(BrotliResponseRejectedError);

      // `noProxy` keeps the local test server off any proxy configured in the environment.
      const envProxyAgent = new Undici.EnvHttpProxyAgent({ noProxy: "127.0.0.1" });
      Undici.setGlobalDispatcher(envProxyAgent);
      rejectBrotliResponsesOnVulnerableNode("24.22.0");
      expect(Undici.getGlobalDispatcher()).not.toBe(envProxyAgent);
      expect(Undici.getGlobalDispatcher()).toBeInstanceOf(Undici.EnvHttpProxyAgent);
      expect(yield* brotliErrorViaGlobalDispatcher).toBeInstanceOf(BrotliResponseRejectedError);
    }),
  );

  // Node 22's built-in undici 6 registers its `--use-env-proxy` agent only under the
  // legacy global key, which loading npm undici overwrites; undici 7+ also registers
  // it under the current key. Either way the guard must keep it. Needs a fresh process.
  it.live("keeps the proxy agent Node's built-in undici installed", () =>
    Effect.gen(function* () {
      const child = yield* runNode(
        [
          "--use-env-proxy",
          "--no-warnings",
          "--input-type=module",
          "--eval",
          `
import { createRequire } from "node:module";
import { rejectBrotliResponsesOnVulnerableNode } from ${JSON.stringify(new URL("./outboundHttp.ts", import.meta.url).href)};

const builtin = (
  globalThis[Symbol.for("undici.globalDispatcher.2")] ??
  globalThis[Symbol.for("undici.globalDispatcher.1")]
)?.constructor.name;
rejectBrotliResponsesOnVulnerableNode("22.22.0");
const undici = createRequire(${JSON.stringify(import.meta.url)})("undici");
console.log(JSON.stringify({ builtin, guarded: undici.getGlobalDispatcher().constructor.name }));
`,
        ],
        // Node installs the agent only when a proxy is configured; nothing is sent through it.
        { HTTP_PROXY: "http://127.0.0.1:9" },
      );
      expect(child.exitCode, child.stderr).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual({
        builtin: "EnvHttpProxyAgent",
        guarded: "EnvHttpProxyAgent",
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

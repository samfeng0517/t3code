import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({ BrowserWindow: {}, session: {} }));

import * as BrowserExtensions from "../../preview/BrowserExtensions.ts";
import { addBrowserExtension, setBrowserExtensionEnabled } from "./browserExtensions.ts";

const status = {
  path: "/ext/a",
  enabled: false,
  name: "Example",
  version: "1.0.0",
  manifestVersion: 3,
  problem: null,
  detail: null,
} as const;

const makeService = () => {
  const calls: Array<readonly [string, ...ReadonlyArray<unknown>]> = [];
  const service = BrowserExtensions.BrowserExtensions.of({
    list: Effect.succeed([status]),
    add: (path) =>
      Effect.sync(() => {
        calls.push(["add", path]);
        return { extensions: [status], refusal: null };
      }),
    setEnabled: (path, enabled) =>
      Effect.sync(() => {
        calls.push(["setEnabled", path, enabled]);
        return { extensions: [status], refusal: null };
      }),
    remove: () => Effect.die("unused"),
    listSources: Effect.die("unused"),
    addFromSource: () => Effect.die("unused"),
    updateFromSources: Effect.die("unused"),
  });
  return { calls, service };
};

describe("browser extension IPC methods", () => {
  it.effect("forwards a decoded path and encodes the mutation result", () =>
    Effect.gen(function* () {
      const { calls, service } = makeService();
      const result = yield* addBrowserExtension
        .handler({ path: "  /ext/a  " })
        .pipe(Effect.provideService(BrowserExtensions.BrowserExtensions, service));

      assert.deepStrictEqual(calls, [["add", "/ext/a"]]);
      assert.deepStrictEqual(result, { extensions: [status], refusal: null });
    }),
  );

  it.effect("rejects malformed payloads before reaching the service", () =>
    Effect.gen(function* () {
      const { calls, service } = makeService();
      const blank = yield* addBrowserExtension
        .handler({ path: "   " })
        .pipe(Effect.provideService(BrowserExtensions.BrowserExtensions, service), Effect.exit);
      const missingFlag = yield* setBrowserExtensionEnabled
        .handler({ path: "/ext/a" })
        .pipe(Effect.provideService(BrowserExtensions.BrowserExtensions, service), Effect.exit);

      assert.isTrue(Exit.isFailure(blank));
      assert.isTrue(Exit.isFailure(missingFlag));
      assert.deepStrictEqual(calls, []);
    }),
  );
});

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as BrowserNotificationPermissions from "./BrowserNotificationPermissions.ts";

describe("BrowserNotificationPermissions", () => {
  it.effect("should restore saved decisions and forget removed sites when reopened", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-notifications-" });
      const storePath = `${directory}/browser-notification-permissions.json`;

      const first = yield* BrowserNotificationPermissions.makeAt(storePath);
      yield* first.set("https://chat.example.com", "allow");
      yield* first.set("https://ads.example.com", "block");
      const reopened = yield* BrowserNotificationPermissions.makeAt(storePath);
      assert.strictEqual(reopened.decisionFor("https://chat.example.com"), "allow");
      assert.strictEqual(reopened.decisionFor("https://ads.example.com"), "block");

      const remaining = yield* reopened.remove("https://ads.example.com");
      assert.deepStrictEqual(remaining, [
        { origin: "https://chat.example.com", decision: "allow" },
      ]);
      const again = yield* BrowserNotificationPermissions.makeAt(storePath);
      assert.isUndefined(again.decisionFor("https://ads.example.com"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("should keep every decision when several are saved at once", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-notifications-" });
      const storePath = `${directory}/browser-notification-permissions.json`;
      const permissions = yield* BrowserNotificationPermissions.makeAt(storePath);
      const origins = Array.from({ length: 6 }, (_, index) => `https://site-${index}.example.com`);

      yield* Effect.forEach(origins, (origin) => permissions.set(origin, "allow"), {
        concurrency: "unbounded",
      });

      const reopened = yield* BrowserNotificationPermissions.makeAt(storePath);
      assert.deepStrictEqual(
        (yield* reopened.list).map((site) => site.origin),
        origins,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("should start empty when the saved file is unreadable", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-notifications-" });
      const storePath = `${directory}/browser-notification-permissions.json`;
      yield* fileSystem.writeFileString(storePath, "not json");

      const permissions = yield* BrowserNotificationPermissions.makeAt(storePath);

      assert.deepStrictEqual(yield* permissions.list, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

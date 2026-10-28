import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { listExtensionSourceProfiles } from "./BrowserExtensionSources.ts";

describe("listExtensionSourceProfiles", () => {
  it.effect(
    "should list the profiles Local State names and skip unsafe directories when a Chromium browser is installed",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-ext-sources-" });
        const chrome = path.join(home, "Library", "Application Support", "Google", "Chrome");
        yield* fileSystem.makeDirectory(chrome, { recursive: true });
        yield* fileSystem.writeFileString(
          path.join(chrome, "Local State"),
          JSON.stringify({
            profile: {
              info_cache: { Default: { name: "Person 1" }, "../escape": { name: "Bad" } },
            },
          }),
        );

        const profiles = yield* listExtensionSourceProfiles({
          path,
          platform: "darwin",
          home,
          appData: undefined,
          localAppData: undefined,
        });

        assert.deepStrictEqual(profiles, [
          {
            sourceId: "chrome",
            sourceName: "Chrome",
            directory: "Default",
            name: "Person 1",
            extensionsDirectory: path.join(chrome, "Default", "Extensions"),
          },
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

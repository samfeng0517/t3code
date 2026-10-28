import { assert, it } from "@effect/vitest";

import { resolveDesktopSshCliRunner } from "./DesktopSshCliRunner.ts";

const base = {
  isDevelopment: false,
  devRemoteEntryPath: undefined,
  nodeEngineRange: ">=24",
  appVersion: "1.2.3",
  releaseBaseUrl: undefined,
} as const;

it("passes the configured release base URL to the archive runner", () => {
  assert.deepEqual(
    resolveDesktopSshCliRunner({ ...base, releaseBaseUrl: "https://releases.example.com/t3" }),
    { archiveVersion: "1.2.3", releaseBaseUrl: "https://releases.example.com/t3" },
  );
  assert.deepEqual(resolveDesktopSshCliRunner(base), { archiveVersion: "1.2.3" });
});

it("uses the dev checkout only in development", () => {
  const devRemoteEntryPath = "/src/t3/bin.mjs";
  assert.deepEqual(
    resolveDesktopSshCliRunner({ ...base, isDevelopment: true, devRemoteEntryPath }),
    { nodeScriptPath: devRemoteEntryPath, nodeEngineRange: ">=24" },
  );
  assert.deepEqual(resolveDesktopSshCliRunner({ ...base, devRemoteEntryPath }), {
    archiveVersion: "1.2.3",
  });
});

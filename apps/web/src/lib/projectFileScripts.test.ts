import { describe, expect, it } from "vite-plus/test";

import { shouldReadCompatScripts } from "./projectFileScripts";

describe("shouldReadCompatScripts", () => {
  const ready = {
    t3ProjectFile: "missing",
    cwd: "/repo",
    canReadFiles: true,
    serverSupportsCompatFiles: true,
  } as const;

  it("asks only when t3.json is missing and the server supports it", () => {
    expect(shouldReadCompatScripts(ready)).toBe(true);
  });

  it.each([
    ["t3.json is present", { t3ProjectFile: "present" }],
    ["t3.json is still loading", { t3ProjectFile: "loading" }],
    ["the server predates the capability", { serverSupportsCompatFiles: false }],
    ["files cannot be read", { canReadFiles: false }],
    ["there is no checkout", { cwd: null }],
  ] as const)("does not ask when %s", (_reason, override) => {
    expect(shouldReadCompatScripts({ ...ready, ...override })).toBe(false);
  });
});

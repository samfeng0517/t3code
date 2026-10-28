import { describe, expect, it } from "@effect/vitest";

import {
  mergeSupersetConfig,
  normalizeRepoRelativePath,
  orcaProjectScripts,
  parseOrcaYaml,
  parseSupersetConfig,
  parseSupersetLocalConfig,
  parseWorktreeInclude,
  shebangShellOptions,
  supersetProjectScripts,
} from "./compatProjectFiles.ts";

describe("parseOrcaYaml", () => {
  it("reads every supported key and maps them onto project scripts", () => {
    const config = parseOrcaYaml(
      [
        "scripts:",
        "  setup: |",
        "    pnpm install",
        "    pnpm build",
        "  archive: echo archived",
        "setupAgentStartupPolicy: wait-for-setup",
        "issueCommand: echo {{issue}}",
        "defaultTabs:",
        "  - title: Agent",
        "  - title: Git status",
        "    command: git status --short",
        "  - command: pnpm dev",
        "    color: '#abc'",
        "worktree:",
        "  sharedDirectories: [.cache, ./.turbo/, 'a\\b', .cache]",
      ].join("\n"),
    );
    expect(config).toEqual({
      setup: "pnpm install\npnpm build",
      archive: "echo archived",
      setupAgentStartupPolicy: "wait-for-setup",
      defaultTabs: [
        { title: "Agent" },
        { title: "Git status", command: "git status --short" },
        { command: "pnpm dev" },
      ],
      sharedDirectories: [".cache", ".turbo", "a/b"],
    });

    const mapped = orcaProjectScripts(config!);
    expect(mapped.scripts).toEqual([
      {
        name: "Orca setup",
        command: "bash -e -c 'pnpm install\npnpm build'",
        icon: "configure",
        runOnWorktreeCreate: true,
        async: false,
      },
      { name: "Git status", command: "git status --short", icon: "play" },
      { name: "Orca tab 3", command: "pnpm dev", icon: "play" },
      // The archive hook only runs once the user imports it as a removal action.
      {
        name: "Orca archive",
        command: "echo archived",
        icon: "configure",
        runOnWorktreeRemove: true,
      },
    ]);
  });

  it("runs a one-line setup as written and starts the agent immediately by default", () => {
    const mapped = orcaProjectScripts(parseOrcaYaml("scripts:\n  setup: pnpm install\n")!);
    expect(mapped.scripts).toEqual([
      {
        name: "Orca setup",
        command: "pnpm install",
        icon: "configure",
        runOnWorktreeCreate: true,
        async: true,
      },
    ]);
  });

  it("quotes scripts with single quotes and replays shebang shell options", () => {
    const script = "#!/usr/bin/env bash -x -o pipefail\necho 'hi'";
    expect(shebangShellOptions(script).options).toEqual(["-x", "-o", "pipefail"]);
    expect(shebangShellOptions("#!/usr/bin/env python3 -u\nprint(1)")).toEqual({
      options: [],
      rejected: [],
    });
    const [setup] = orcaProjectScripts(
      parseOrcaYaml(`scripts:\n  setup: |\n    ${script.replace("\n", "\n    ")}\n`)!,
    ).scripts;
    expect(setup!.command).toBe(
      `bash -e -x -o pipefail -c '#!/usr/bin/env bash -x -o pipefail\necho '\\''hi'\\'''`,
    );
  });

  it.each([
    ["#!/usr/bin/env -S bash -euo pipefail", ["-e", "-u", "-o", "pipefail"], []],
    ["#!/bin/bash -e -o pipefail", ["-e", "-o", "pipefail"], []],
    ["#!/bin/sh +e", ["+e"], []],
    ["#!/bin/bash -i", [], ["-i"]],
    ["#!/bin/bash -exi -o posix -c", ["-e", "-x"], ["-i", "-o posix", "-c"]],
  ] as const)("replays only safe options from %s", (shebang, options, rejected) => {
    expect(shebangShellOptions(`${shebang}\necho hi`)).toEqual({ options, rejected });
  });

  it("rejects the whole file for invalid YAML, duplicate keys, a non-mapping root, or oversize", () => {
    expect(parseOrcaYaml("scripts: [unclosed")).toBeNull();
    expect(parseOrcaYaml("scripts:\n  setup: a\n  setup: b\n")).toBeNull();
    expect(parseOrcaYaml("defaultTabs:\n  - title: a\n    title: b\n")).toBeNull();
    expect(parseOrcaYaml("- just\n- a list\n")).toBeNull();
    expect(parseOrcaYaml(`scripts:\n  setup: ok\n# ${"x".repeat(262_144)}`)).toBeNull();
  });

  it("drops invalid or oversized fields while keeping valid siblings", () => {
    const config = parseOrcaYaml(
      [
        `scripts:\n  setup: "${"x".repeat(65_537)}"\n  archive: "  "`,
        "setupAgentStartupPolicy: later",
        "defaultTabs: not-a-list",
        "worktree:",
        "  sharedDirectories: [/abs, 'C:\\x', ../up, a/./b, a//b, .git, sub/.git/x, '', ok]",
      ].join("\n"),
    );
    expect(config).toEqual({ defaultTabs: [], sharedDirectories: ["ok"] });
  });

  it("only considers the first 100 shared directories", () => {
    const entries = Array.from({ length: 101 }, (_, index) => `d${index}`);
    expect(
      parseOrcaYaml(`worktree:\n  sharedDirectories: [${entries.join(", ")}]\n`)?.sharedDirectories,
    ).toHaveLength(100);
  });
});

describe("parseWorktreeInclude", () => {
  it("keeps literal paths and skips comments, globs, negations, and unsafe paths", () => {
    expect(
      parseWorktreeInclude(
        [
          "# secrets",
          "",
          ".env",
          "  .env.local  ",
          "./.vscode/settings.json",
          "config\\local.json",
          "build/",
          ".env # inline comments are part of the path",
          "*.pem",
          "keys/?",
          "!.env.example",
          "../outside",
          "/etc/passwd",
          ".git/config",
          ".env",
        ].join("\r\n"),
      ),
    ).toEqual([
      ".env",
      ".env.local",
      ".vscode/settings.json",
      "config/local.json",
      "build",
      ".env # inline comments are part of the path",
    ]);
  });

  it("caps candidates and ignores an oversized file", () => {
    const lines = Array.from({ length: 1_100 }, (_, index) => `f${index}`);
    expect(parseWorktreeInclude(lines.join("\n"))).toHaveLength(1_000);
    expect(parseWorktreeInclude(`.env\n${"#".repeat(262_144)}`)).toEqual([]);
  });

  it("normalizes paths the same way as shared directories", () => {
    expect(normalizeRepoRelativePath("./a\\b/")).toBe("a/b");
    expect(normalizeRepoRelativePath("D:/x")).toBeNull();
  });
});

describe("Superset config", () => {
  it("maps setup, run, and teardown with the configured cwd", () => {
    const config = parseSupersetConfig(
      JSON.stringify({
        setup: ["pnpm install", " ", "cp ../.env .env"],
        teardown: ["docker compose down"],
        run: ["pnpm dev"],
        cwd: "./apps/web/",
      }),
    );
    expect(config).toEqual({
      setup: ["pnpm install", "cp ../.env .env"],
      teardown: ["docker compose down"],
      run: ["pnpm dev"],
      cwd: "apps/web",
    });
    const mapped = supersetProjectScripts(config!, new Set());
    expect(mapped.scripts).toEqual([
      {
        name: "Superset setup",
        command: "cd -- 'apps/web' && pnpm install && cp ../.env .env",
        icon: "configure",
        runOnWorktreeCreate: true,
        async: true,
      },
      { name: "Superset run", command: "cd -- 'apps/web' && pnpm dev", icon: "play" },
      {
        name: "Superset teardown",
        command: "cd -- 'apps/web' && docker compose down",
        icon: "configure",
        runOnWorktreeRemove: true,
      },
    ]);
  });

  it("falls back to .superset/<key>.sh only when the key is missing, not when it is empty", () => {
    const mapped = supersetProjectScripts(
      parseSupersetConfig(JSON.stringify({ teardown: [], run: ["pnpm dev"] }))!,
      new Set(["setup", "teardown", "run"]),
    );
    expect(mapped.scripts.map((script) => [script.name, script.command])).toEqual([
      ["Superset setup", "bash .superset/setup.sh"],
      ["Superset run", "pnpm dev"],
    ]);
  });

  it("merges the local config: arrays replace, before/after wrap", () => {
    const base = parseSupersetConfig(
      JSON.stringify({ setup: ["install"], teardown: ["down"], run: ["dev"] }),
    )!;
    const local = parseSupersetLocalConfig(
      JSON.stringify({
        setup: { before: ["login"], after: ["seed"] },
        run: ["dev --port 4000"],
        teardown: { after: ["cleanup"] },
      }),
    );
    expect(mergeSupersetConfig(base, local)).toEqual({
      setup: ["login", "install", "seed"],
      teardown: ["down", "cleanup"],
      run: ["dev --port 4000"],
    });
    expect(mergeSupersetConfig(base, null)).toBe(base);
  });

  it("rejects malformed JSON and skips mistyped keys", () => {
    expect(parseSupersetConfig("{ nope")).toBeNull();
    expect(parseSupersetConfig("[]")).toBeNull();
    expect(parseSupersetConfig(JSON.stringify({ setup: "pnpm i", run: ["dev"] }))).toEqual({
      run: ["dev"],
    });
  });

  it.each(["../x", "/abs", "C:\\x", "a/../b", 3])(
    "rejects the whole file for an unsafe cwd %s",
    (cwd) => {
      expect(parseSupersetConfig(JSON.stringify({ run: ["dev"], cwd }))).toBeNull();
    },
  );
});

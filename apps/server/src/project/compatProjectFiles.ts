/**
 * Parsers for the project files of Superset (`.superset/config.json`) and Orca (`orca.yaml`,
 * `.worktreeinclude`), mapped onto T3 Code's own project scripts. The limits and normalization
 * follow each tool's published rules so a repository behaves the same in both apps.
 */
import type { CompatProjectFileSource, T3ProjectFileScript } from "@t3tools/contracts";
import { parseDocument } from "yaml";

export const ORCA_YAML_FILE = "orca.yaml";
export const WORKTREE_INCLUDE_FILE = ".worktreeinclude";
export const SUPERSET_CONFIG_FILE = ".superset/config.json";
export const SUPERSET_LOCAL_CONFIG_FILE = ".superset/config.local.json";

const ORCA_YAML_MAX_BYTES = 262_144;
const ORCA_YAML_FIELD_MAX_BYTES = 65_536;
const ORCA_YAML_MAX_ALIAS_COUNT = 100;
const ORCA_YAML_MAX_COLLECTION_ENTRIES = 256;
const ORCA_MAX_SHARED_DIRECTORIES = 100;
export const WORKTREE_INCLUDE_MAX_BYTES = 262_144;
const WORKTREE_INCLUDE_MAX_CANDIDATES = 1_000;

const textEncoder = new TextEncoder();

/** UTF-8 never takes fewer bytes than UTF-16 code units, so the unit check short-circuits. */
function withinLimit(value: string, maxBytes: number): boolean {
  return value.length <= maxBytes && textEncoder.encode(value).byteLength <= maxBytes;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function orcaString(value: unknown): string | undefined {
  if (typeof value !== "string" || !withinLimit(value, ORCA_YAML_FIELD_MAX_BYTES)) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalizes a repository-relative path the way Orca does. Paths that would still need collapsing
 * (`apps/./web`) are rejected rather than rewritten so the stored entry always equals what git
 * reports for it.
 */
export function normalizeRepoRelativePath(raw: string): string | null {
  const normalized = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (normalized.length === 0 || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    return null;
  }
  const segments = normalized.split("/");
  return segments.some(
    (segment) => segment === "" || segment === "." || segment === ".." || segment === ".git",
  )
    ? null
    : normalized;
}

export interface OrcaDefaultTab {
  readonly title?: string;
  readonly command?: string;
}

export interface OrcaConfig {
  readonly setup?: string;
  readonly archive?: string;
  readonly setupAgentStartupPolicy?: "start-immediately" | "wait-for-setup";
  readonly defaultTabs: ReadonlyArray<OrcaDefaultTab>;
  readonly sharedDirectories: ReadonlyArray<string>;
}

/** Returns null for anything Orca rejects as a whole: bad YAML, any duplicate key, a non-mapping root. */
export function parseOrcaYaml(contents: string): OrcaConfig | null {
  if (!withinLimit(contents, ORCA_YAML_MAX_BYTES)) return null;
  let root: unknown;
  try {
    const document = parseDocument(contents, {
      merge: true,
      uniqueKeys: true,
      logLevel: "silent",
      prettyErrors: false,
    });
    if (document.errors.length > 0) return null;
    root = document.toJS({ maxAliasCount: ORCA_YAML_MAX_ALIAS_COUNT });
  } catch {
    return null;
  }
  const record = asRecord(root);
  if (record === null) return null;

  const scripts = asRecord(record.scripts);
  const setup = scripts ? orcaString(scripts.setup) : undefined;
  const archive = scripts ? orcaString(scripts.archive) : undefined;
  const policy = record.setupAgentStartupPolicy;

  const defaultTabs: OrcaDefaultTab[] = [];
  if (
    Array.isArray(record.defaultTabs) &&
    record.defaultTabs.length <= ORCA_YAML_MAX_COLLECTION_ENTRIES
  ) {
    for (const entry of record.defaultTabs) {
      const tab = asRecord(entry);
      if (tab === null) continue;
      const title = orcaString(tab.title);
      const command = orcaString(tab.command);
      // A color-only tab is valid for Orca; it is kept so the first-tab position stays honest.
      const color = orcaString(tab.color);
      if (!title && !command && !(color && /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(color))) {
        continue;
      }
      defaultTabs.push({ ...(title ? { title } : {}), ...(command ? { command } : {}) });
    }
  }

  const sharedDirectories = new Set<string>();
  const worktree = asRecord(record.worktree);
  if (worktree && Array.isArray(worktree.sharedDirectories)) {
    for (const entry of worktree.sharedDirectories.slice(0, ORCA_MAX_SHARED_DIRECTORIES)) {
      const raw = orcaString(entry);
      const normalized = raw === undefined ? null : normalizeRepoRelativePath(raw);
      if (normalized !== null) sharedDirectories.add(normalized);
    }
  }

  return {
    ...(setup ? { setup } : {}),
    ...(archive ? { archive } : {}),
    ...(policy === "start-immediately" || policy === "wait-for-setup"
      ? { setupAgentStartupPolicy: policy }
      : {}),
    defaultTabs,
    sharedDirectories: [...sharedDirectories],
  };
}

/** One literal path per line; comments, globs, and negations are skipped, never interpreted. */
export function parseWorktreeInclude(contents: string): ReadonlyArray<string> {
  if (!withinLimit(contents, WORKTREE_INCLUDE_MAX_BYTES)) return [];
  const entries = new Set<string>();
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (
      trimmed.length === 0 ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("!") ||
      /[*?]/.test(trimmed)
    ) {
      continue;
    }
    const normalized = normalizeRepoRelativePath(trimmed);
    if (normalized === null) continue;
    entries.add(normalized);
    if (entries.size >= WORKTREE_INCLUDE_MAX_CANDIDATES) break;
  }
  return [...entries];
}

export const SUPERSET_SCRIPT_KEYS = ["setup", "teardown", "run"] as const;
export type SupersetScriptKey = (typeof SUPERSET_SCRIPT_KEYS)[number];

export interface SupersetConfig {
  readonly setup?: ReadonlyArray<string>;
  readonly teardown?: ReadonlyArray<string>;
  readonly run?: ReadonlyArray<string>;
  readonly cwd?: string;
}

export interface SupersetLocalWrap {
  readonly before: ReadonlyArray<string>;
  readonly after: ReadonlyArray<string>;
}

export type SupersetLocalConfig = {
  readonly [K in SupersetScriptKey]?: ReadonlyArray<string> | SupersetLocalWrap;
};

function parseJsonRecord(contents: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(contents));
  } catch {
    return null;
  }
}

function commandList(value: unknown): ReadonlyArray<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) =>
    typeof entry === "string" && entry.trim().length > 0 ? [entry.trim()] : [],
  );
}

export function parseSupersetConfig(contents: string): SupersetConfig | null {
  const record = parseJsonRecord(contents);
  if (record === null) return null;
  // An absolute or escaping cwd would run the commands somewhere other than the author meant,
  // so the whole file is rejected instead of silently running them at the root.
  const cwd =
    typeof record.cwd === "string" && record.cwd.trim().length > 0
      ? normalizeRepoRelativePath(record.cwd)
      : null;
  if (record.cwd !== undefined && cwd === null) return null;
  const config: { -readonly [K in keyof SupersetConfig]: SupersetConfig[K] } = {};
  for (const key of SUPERSET_SCRIPT_KEYS) {
    const commands = commandList(record[key]);
    if (commands !== undefined) config[key] = commands;
  }
  if (cwd !== null) config.cwd = cwd;
  return config;
}

export function parseSupersetLocalConfig(contents: string): SupersetLocalConfig | null {
  const record = parseJsonRecord(contents);
  if (record === null) return null;
  const config: { -readonly [K in SupersetScriptKey]?: SupersetLocalConfig[K] } = {};
  for (const key of SUPERSET_SCRIPT_KEYS) {
    const value = record[key];
    const replacement = commandList(value);
    if (replacement !== undefined) {
      config[key] = replacement;
      continue;
    }
    const wrap = asRecord(value);
    if (wrap !== null) {
      config[key] = {
        before: commandList(wrap.before) ?? [],
        after: commandList(wrap.after) ?? [],
      };
    }
  }
  return config;
}

/** A plain array replaces the committed commands; `{ before, after }` wraps them. */
export function mergeSupersetConfig(
  base: SupersetConfig,
  local: SupersetLocalConfig | null,
): SupersetConfig {
  if (local === null) return base;
  const merged: { -readonly [K in keyof SupersetConfig]: SupersetConfig[K] } = { ...base };
  for (const key of SUPERSET_SCRIPT_KEYS) {
    const override = local[key];
    if (override === undefined) continue;
    merged[key] =
      "before" in override
        ? [...override.before, ...(base[key] ?? []), ...override.after]
        : [...override];
  }
  return merged;
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

const SAFE_SHORT_OPTIONS = new Set(["e", "u", "x"]);
const SAFE_LONG_OPTIONS = new Set(["errexit", "nounset", "xtrace", "pipefail", "noclobber"]);

export interface ShebangShellOptions {
  readonly options: ReadonlyArray<string>;
  /** Options on the `#!` line that are not replayed, such as `-i` or `-c`. */
  readonly rejected: ReadonlyArray<string>;
}

/**
 * Shell options on a leading bash/sh `#!` line, which Orca replays onto its bash runner. Only
 * options that change error handling or tracing are kept: anything else (`-i`, `-r`, `-c`) would
 * change how the script itself is read.
 */
export function shebangShellOptions(script: string): ShebangShellOptions {
  const firstLine = script.split(/\r?\n/, 1)[0] ?? "";
  if (!firstLine.startsWith("#!")) return { options: [], rejected: [] };
  const tokens = firstLine.slice(2).trim().split(/\s+/);
  let index = 0;
  if (tokens[index]?.split("/").at(-1) === "env") {
    index += 1;
    if (tokens[index] === "-S") index += 1;
  }
  const interpreter = tokens[index]?.split("/").at(-1);
  if (interpreter !== "bash" && interpreter !== "sh") return { options: [], rejected: [] };
  const options: string[] = [];
  const rejected: string[] = [];
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor]!;
    if (!/^[-+][a-zA-Z]+$/.test(token)) {
      rejected.push(token);
      continue;
    }
    const sign = token[0]!;
    for (const flag of token.slice(1)) {
      if (flag === "o") {
        // `-o` takes the next token as its name, also inside a cluster such as `-euo pipefail`.
        cursor += 1;
        const name = tokens[cursor] ?? "";
        if (SAFE_LONG_OPTIONS.has(name)) options.push(`${sign}o`, name);
        else rejected.push(`${sign}o ${name}`.trim());
      } else if (SAFE_SHORT_OPTIONS.has(flag)) {
        options.push(`${sign}${flag}`);
      } else {
        rejected.push(`${sign}${flag}`);
      }
    }
  }
  return { options, rejected };
}

/**
 * Commands typed into a terminal. A one-line script without `#!` runs as written, which reads
 * better in the scripts menu and behaves the same; anything else goes through bash with `set -e`
 * like Orca's runner.
 */
function orcaTerminalCommand(script: string): string {
  if (!script.includes("\n") && !script.startsWith("#!")) return script;
  return [
    "bash",
    "-e",
    ...shebangShellOptions(script).options,
    "-c",
    shellSingleQuote(script),
  ].join(" ");
}

function supersetShellCommand(commands: ReadonlyArray<string>, cwd: string | undefined): string {
  const joined = commands.join(" && ");
  return cwd === undefined ? joined : `cd -- ${shellSingleQuote(cwd)} && ${joined}`;
}

/**
 * Commands for one Superset key. Only a missing key falls back to `.superset/<key>.sh`; an
 * explicitly empty list means "nothing to run".
 */
function supersetCommand(
  config: SupersetConfig,
  key: SupersetScriptKey,
  fallbackScriptExists: boolean,
): string | null {
  const commands = config[key];
  if (commands === undefined) return fallbackScriptExists ? `bash .superset/${key}.sh` : null;
  return commands.length > 0 ? supersetShellCommand(commands, config.cwd) : null;
}

export interface CompatProjectScripts {
  readonly source: CompatProjectFileSource;
  readonly scripts: ReadonlyArray<T3ProjectFileScript>;
}

export function orcaProjectScripts(config: OrcaConfig): CompatProjectScripts {
  const scripts: T3ProjectFileScript[] = [];
  if (config.setup) {
    scripts.push({
      name: "Orca setup",
      command: orcaTerminalCommand(config.setup),
      icon: "configure",
      runOnWorktreeCreate: true,
      async: config.setupAgentStartupPolicy !== "wait-for-setup",
    });
  }
  config.defaultTabs.forEach((tab, index) => {
    if (!tab.command) return;
    scripts.push({
      name: tab.title ?? `Orca tab ${index + 1}`,
      command: tab.command,
      icon: "play",
    });
  });
  if (config.archive) {
    scripts.push({
      name: "Orca archive",
      command: orcaTerminalCommand(config.archive),
      icon: "configure",
      runOnWorktreeRemove: true,
    });
  }
  return { source: "orca.yaml", scripts };
}

export function supersetProjectScripts(
  config: SupersetConfig,
  fallbackScripts: ReadonlySet<SupersetScriptKey>,
): CompatProjectScripts {
  const scripts: T3ProjectFileScript[] = [];
  const setup = supersetCommand(config, "setup", fallbackScripts.has("setup"));
  if (setup !== null) {
    scripts.push({
      name: "Superset setup",
      command: setup,
      icon: "configure",
      runOnWorktreeCreate: true,
      async: true,
    });
  }
  const run = supersetCommand(config, "run", fallbackScripts.has("run"));
  if (run !== null) {
    scripts.push({ name: "Superset run", command: run, icon: "play" });
  }
  const teardown = supersetCommand(config, "teardown", fallbackScripts.has("teardown"));
  if (teardown !== null) {
    scripts.push({
      name: "Superset teardown",
      command: teardown,
      icon: "configure",
      runOnWorktreeRemove: true,
    });
  }
  return { source: ".superset/config.json", scripts };
}

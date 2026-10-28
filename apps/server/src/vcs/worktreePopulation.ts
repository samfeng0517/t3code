// @effect-diagnostics nodeBuiltinImport:off - Effect's symlink has no type argument, and Windows needs a junction to link without elevation.
import * as NodeFSP from "node:fs/promises";

import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";

import {
  ORCA_YAML_FILE,
  WORKTREE_INCLUDE_FILE,
  WORKTREE_INCLUDE_MAX_BYTES,
  parseOrcaYaml,
  parseWorktreeInclude,
} from "../project/compatProjectFiles.ts";

// Orca's admission limits for `.worktreeinclude`, measured before anything is copied.
const COPY_BUDGET_BYTES = 2 * 1024 ** 3;
const COPY_BUDGET_ENTRIES = 50_000;

export interface WorktreePopulationSkip {
  readonly path: string;
  readonly reason:
    | "not-ignored"
    | "over-budget"
    | "failed"
    /** Behind a symlink or inside a submodule in the main checkout, which git cannot classify. */
    | "unsupported-path"
    /** A symlinked folder on the branch would put the result outside the worktree. */
    | "outside-worktree"
    /** Git could not say whether the path is ignored. */
    | "unchecked";
}

export interface WorktreePopulationResult {
  readonly linked: ReadonlyArray<string>;
  readonly copied: ReadonlyArray<string>;
  /** Only entries the user would want to hear about; missing sources and existing destinations are silent. */
  readonly skipped: ReadonlyArray<WorktreePopulationSkip>;
}

export interface WorktreePopulationDeps {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly platform: NodeJS.Platform;
  /**
   * The subset of `paths` git ignores in `repoRoot`, or null when git refused the batch (it exits
   * 128 for a path it cannot classify). Tracked paths are never ignored.
   */
  readonly checkIgnore: (
    repoRoot: string,
    paths: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlySet<string> | null>;
  /** Submodule paths declared in the main checkout's `.gitmodules`. */
  readonly submodulePaths: (repoRoot: string) => Effect.Effect<ReadonlyArray<string>>;
  /**
   * A `dir/` ignore pattern does not match a symlink, so a linked shared directory would show as
   * untracked work forever unless it is excluded locally.
   */
  readonly excludeLocally: (
    worktreePath: string,
    paths: ReadonlyArray<string>,
  ) => Effect.Effect<void>;
  /** Overrides Orca's copy budget; only tests need a smaller one. */
  readonly copyBudget?: { readonly bytes: number; readonly entries: number };
}

/** An anchored gitignore line that matches exactly `entry`, with pattern characters escaped. */
export function gitignoreLiteralPattern(entry: string): string {
  const escaped = entry
    .replace(/[\\*?[]/g, (char) => `\\${char}`)
    .replace(/ +$/, (spaces) => "\\ ".repeat(spaces.length));
  return `/${escaped}`;
}

function ancestorsOf(entry: string): ReadonlyArray<string> {
  const segments = entry.split("/");
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

/**
 * Carries a primary checkout's gitignored state into a new worktree: `worktree.sharedDirectories`
 * from orca.yaml are linked, `.worktreeinclude` entries are copied. Both are read from the primary
 * checkout, never from the branch being checked out, and an existing destination is never touched.
 */
export function makeWorktreePopulator(deps: WorktreePopulationDeps) {
  const { fileSystem, path } = deps;

  const readSmallFile = (filePath: string) =>
    fileSystem.stat(filePath).pipe(
      Effect.flatMap((info) =>
        info.type === "File" && Number(info.size) <= WORKTREE_INCLUDE_MAX_BYTES
          ? fileSystem.readFileString(filePath)
          : Effect.succeed(""),
      ),
      Effect.orElseSucceed(() => ""),
    );

  const exists = (target: string) =>
    fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));

  const isLink = (target: string) =>
    fileSystem.readLink(target).pipe(Effect.option, Effect.map(Option.isSome));

  const realPath = (target: string) =>
    fileSystem.realPath(target).pipe(Effect.orElseSucceed(() => path.resolve(target)));

  const isInside = (root: string, target: string) =>
    target === root || target.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);

  /**
   * A branch can commit `.vscode` as a symlink to somewhere else; creating the parent folders of a
   * destination through it would write outside the worktree.
   */
  const destinationInside = Effect.fnUntraced(function* (
    realWorktree: string,
    destination: string,
  ) {
    let ancestor = path.dirname(destination);
    while (!(yield* exists(ancestor))) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return false;
      ancestor = parent;
    }
    return isInside(realWorktree, yield* realPath(ancestor));
  });

  /**
   * Counts entries and bytes without following nested links, and stops as soon as the remaining
   * budget is exceeded so one huge directory cannot make creation walk the whole tree.
   */
  // Recursive per-entry traversal; populateWorktree owns the span.
  const measure = Effect.fnUntraced(function* (
    target: string,
    remaining: { entries: number; bytes: number },
    topLevel: boolean,
  ): Effect.fn.Return<{ entries: number; bytes: number } | null> {
    if (remaining.entries < 1) return null;
    if (!topLevel && (yield* isLink(target))) return { entries: 1, bytes: 0 };
    const info = yield* fileSystem.stat(target).pipe(Effect.option);
    if (Option.isNone(info)) return { entries: 0, bytes: 0 };
    if (info.value.type !== "Directory") {
      const bytes = Number(info.value.size);
      return bytes > remaining.bytes ? null : { entries: 1, bytes };
    }
    const total = { entries: 1, bytes: 0 };
    const children = yield* fileSystem.readDirectory(target).pipe(Effect.orElseSucceed(() => []));
    for (const name of children) {
      const child = yield* measure(
        path.join(target, name),
        { entries: remaining.entries - total.entries, bytes: remaining.bytes - total.bytes },
        false,
      );
      if (child === null) return null;
      total.entries += child.entries;
      total.bytes += child.bytes;
    }
    return total.entries > remaining.entries ? null : total;
  });

  const link = (source: string, destination: string) =>
    Effect.tryPromise(() =>
      deps.platform === "win32"
        ? NodeFSP.symlink(source, destination, "junction").catch(() =>
            NodeFSP.symlink(source, destination, "dir"),
          )
        : NodeFSP.symlink(source, destination, "dir"),
    );

  /**
   * Classifies every entry with one git call. Entries git cannot classify are filtered first, and
   * if the batch still fails each entry is checked alone so one bad line only skips itself.
   */
  const classify = Effect.fnUntraced(function* (repoRoot: string, entries: ReadonlyArray<string>) {
    const submodules = yield* deps.submodulePaths(repoRoot);
    const unsupported = new Set<string>();
    for (const entry of entries) {
      const inSubmodule = submodules.some(
        (submodule) => entry === submodule || entry.startsWith(`${submodule}/`),
      );
      let behindLink = false;
      for (const ancestor of ancestorsOf(entry)) {
        if (yield* isLink(path.join(repoRoot, ancestor))) {
          behindLink = true;
          break;
        }
      }
      if (inSubmodule || behindLink) unsupported.add(entry);
    }
    const candidates = entries.filter((entry) => !unsupported.has(entry));
    const unchecked = new Set<string>();
    let ignored =
      candidates.length === 0 ? new Set<string>() : yield* deps.checkIgnore(repoRoot, candidates);
    if (ignored === null) {
      const perEntry = new Set<string>();
      for (const entry of candidates) {
        const result = yield* deps.checkIgnore(repoRoot, [entry]);
        if (result === null) unchecked.add(entry);
        else if (result.has(entry)) perEntry.add(entry);
      }
      ignored = perEntry;
    }
    return { ignored, unsupported, unchecked };
  });

  return Effect.fn("GitVcsDriver.populateWorktree")(function* (input: {
    readonly repoRoot: string;
    readonly worktreePath: string;
  }) {
    const orca = parseOrcaYaml(yield* readSmallFile(path.join(input.repoRoot, ORCA_YAML_FILE)));
    const shared = orca?.sharedDirectories ?? [];
    const includes = parseWorktreeInclude(
      yield* readSmallFile(path.join(input.repoRoot, WORKTREE_INCLUDE_FILE)),
    );
    const linked: string[] = [];
    const copied: string[] = [];
    const skipped: WorktreePopulationSkip[] = [];
    if (shared.length === 0 && includes.length === 0) return { linked, copied, skipped };

    const { ignored, unsupported, unchecked } = yield* classify(input.repoRoot, [
      ...new Set([...shared, ...includes]),
    ]);
    const realWorktree = yield* realPath(input.worktreePath);
    /** Null when the entry may be created; otherwise why it is skipped, or "silent". */
    const admit = Effect.fnUntraced(function* (entry: string, destination: string) {
      if (unsupported.has(entry)) return "unsupported-path" as const;
      if (unchecked.has(entry)) return "unchecked" as const;
      if (!ignored.has(entry)) return "not-ignored" as const;
      // Covers paths already present, including through a shared directory.
      if ((yield* exists(destination)) || (yield* isLink(destination))) return "silent" as const;
      if (!(yield* destinationInside(realWorktree, destination)))
        return "outside-worktree" as const;
      return null;
    });

    for (const entry of shared) {
      const source = path.join(input.repoRoot, entry);
      const destination = path.join(input.worktreePath, entry);
      const info = yield* fileSystem.stat(source).pipe(Effect.option);
      if (Option.isNone(info) || info.value.type !== "Directory") continue;
      const refusal = yield* admit(entry, destination);
      if (refusal !== null) {
        if (refusal !== "silent") skipped.push({ path: entry, reason: refusal });
        continue;
      }
      yield* fileSystem.makeDirectory(path.dirname(destination), { recursive: true }).pipe(
        Effect.andThen(link(source, destination)),
        Effect.match({
          onSuccess: () => linked.push(entry),
          onFailure: () => skipped.push({ path: entry, reason: "failed" }),
        }),
      );
    }

    if (linked.length > 0) yield* deps.excludeLocally(input.worktreePath, linked);

    // Admission is per entry: one that does not fit is skipped and later, smaller ones still copy.
    const budget = {
      entries: deps.copyBudget?.entries ?? COPY_BUDGET_ENTRIES,
      bytes: deps.copyBudget?.bytes ?? COPY_BUDGET_BYTES,
    };
    for (const entry of includes) {
      const source = path.join(input.repoRoot, entry);
      const destination = path.join(input.worktreePath, entry);
      if (!(yield* exists(source))) continue;
      const refusal = yield* admit(entry, destination);
      if (refusal !== null) {
        if (refusal !== "silent") skipped.push({ path: entry, reason: refusal });
        continue;
      }
      const size = yield* measure(source, budget, true);
      if (size === null) {
        skipped.push({ path: entry, reason: "over-budget" });
        continue;
      }
      budget.entries -= size.entries;
      budget.bytes -= size.bytes;
      // A top-level link is copied as its target's contents; nested links stay links.
      yield* fileSystem.realPath(source).pipe(
        Effect.tap(() => fileSystem.makeDirectory(path.dirname(destination), { recursive: true })),
        Effect.flatMap((realSource) => fileSystem.copy(realSource, destination)),
        Effect.match({
          onSuccess: () => copied.push(entry),
          onFailure: () => skipped.push({ path: entry, reason: "failed" }),
        }),
      );
    }
    return { linked, copied, skipped };
  });
}

const SKIP_REASON_TEXT: Record<WorktreePopulationSkip["reason"], string> = {
  "not-ignored": "not gitignored",
  "over-budget": "over the copy limit",
  failed: "could not be created",
  "unsupported-path": "behind a symlink or in a submodule",
  "outside-worktree": "would land outside the worktree",
  unchecked: "git could not check it",
};

/** English, like every other worktree setup stage detail the server produces. */
export function worktreePopulationWarning(result: WorktreePopulationResult): string | null {
  if (result.skipped.length === 0) return null;
  return `Skipped ${result.skipped
    .map((skip) => `${skip.path} (${SKIP_REASON_TEXT[skip.reason]})`)
    .join(", ")}`;
}

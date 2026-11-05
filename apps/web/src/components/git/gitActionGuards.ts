import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentId,
  OrchestrationV2ThreadShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

interface RepoScope {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  /** Whether the project's checkout belongs to this repository (see `projectInRepoChecker`). */
  readonly projectInRepo: (projectId: ProjectId) => Promise<boolean>;
  readonly environmentId: EnvironmentId;
  readonly repoRoot: string;
}

function trimSeparator(path: string): string {
  return path.length > 1 ? path.replace(/[\\/]+$/, "") : path;
}

function isInside(path: string, root: string): boolean {
  return path.startsWith(`${root}/`) || path.startsWith(`${root}\\`);
}

/**
 * Membership comes from `rev-parse --show-toplevel`, not paths: a nested project folder can be
 * its own repository. `worktreePaths` adds linked worktrees, which share this repository's
 * branches; checkout guards leave them out because they keep their own files.
 */
export function projectInRepoChecker(input: {
  readonly projectRootOf: (projectId: ProjectId) => string | null;
  readonly repoRoot: string;
  readonly showToplevel: (cwd: string) => Promise<string | null>;
  readonly worktreePaths?: ReadonlyArray<string>;
}): (projectId: ProjectId) => Promise<boolean> {
  const repoRoot = trimSeparator(input.repoRoot);
  const roots = new Set([repoRoot, ...(input.worktreePaths ?? []).map(trimSeparator)]);
  const lookups = new Map<string, Promise<boolean>>();
  return (projectId) => {
    const projectRoot = input.projectRootOf(projectId);
    if (projectRoot === null) return Promise.resolve(false);
    const root = trimSeparator(projectRoot);
    if (roots.has(root)) return Promise.resolve(true);
    if (!isInside(root, repoRoot)) return Promise.resolve(false);
    let lookup = lookups.get(root);
    if (lookup === undefined) {
      // An unknown toplevel keeps the guard on: a needless warning beats a stranded thread.
      lookup = input
        .showToplevel(root)
        .then((toplevel) => toplevel === null || roots.has(trimSeparator(toplevel)));
      lookups.set(root, lookup);
    }
    return lookup;
  };
}

async function filterThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  keep: (thread: EnvironmentThreadShell) => boolean | Promise<boolean>,
): Promise<ReadonlyArray<EnvironmentThreadShell>> {
  const kept = await Promise.all(threads.map(keep));
  return threads.filter((_, index) => kept[index]);
}

/** Threads whose recorded branch is `branch` in this repository; renaming it would strand them. */
export function threadsUsingBranch(
  input: RepoScope & {
    readonly worktreePaths: ReadonlyArray<string>;
    readonly branch: string;
  },
): Promise<ReadonlyArray<EnvironmentThreadShell>> {
  const repoRoot = trimSeparator(input.repoRoot);
  const worktrees = new Set(input.worktreePaths.map(trimSeparator));
  const onBranch = input.threads.filter(
    (thread) => thread.environmentId === input.environmentId && thread.branch === input.branch,
  );
  return filterThreads(onBranch, (thread) => {
    if (thread.worktreePath !== null) {
      const worktree = trimSeparator(thread.worktreePath);
      if (worktree === repoRoot || worktrees.has(worktree)) return true;
    }
    // A local thread, or one whose worktree was removed: the branch still lives in its
    // project's repository.
    return input.projectInRepo(thread.projectId);
  });
}

/** Running threads that share the repository root's checkout, which a checkout would change under them. */
export function activeRootThreads(
  input: RepoScope,
): Promise<ReadonlyArray<EnvironmentThreadShell>> {
  const active = input.threads.filter(
    (thread) =>
      thread.environmentId === input.environmentId &&
      thread.worktreePath === null &&
      threadRuntimeIsActive(thread.runtime),
  );
  return filterThreads(active, (thread) => input.projectInRepo(thread.projectId));
}

type WorktreeThreadRow = Pick<
  OrchestrationV2ThreadShell,
  "id" | "title" | "lineage" | "settledOverride"
>;

/**
 * The first of the worktree's threads (from the server, archived ones excluded) that still holds
 * it: one that is running, or whose root thread is not settled. The shell omits older settled
 * threads and idle subagent children; `familyOf` reads an omitted thread's family, and a root the
 * shell omits is settled, since unsettled roots are always listed. `"unknown"` when a read fails.
 */
export async function worktreeHoldingThread(input: {
  readonly threadIds: ReadonlyArray<ThreadId>;
  readonly shellOf: (threadId: ThreadId) => EnvironmentThreadShell | null;
  readonly familyOf: (threadId: ThreadId) => Promise<ReadonlyArray<WorktreeThreadRow> | null>;
}): Promise<WorktreeThreadRow | "unknown" | null> {
  for (const threadId of input.threadIds) {
    const shell = input.shellOf(threadId);
    if (shell !== null && threadRuntimeIsActive(shell.runtime)) return shell;
    let family: ReadonlyArray<WorktreeThreadRow> = [];
    if (shell === null) {
      const read = await input.familyOf(threadId);
      if (read === null) return "unknown";
      family = read;
    }
    // A thread in neither was deleted or archived since the server listed it.
    const thread = shell ?? family.find((row) => row.id === threadId);
    if (thread === undefined) continue;
    const rootId = thread.lineage.rootThreadId;
    const root = input.shellOf(rootId) ?? family.find((row) => row.id === rootId);
    if (root !== undefined && root !== null && root.settledOverride !== "settled") return thread;
  }
  return null;
}

import type { GitWorktreeBaseWarning } from "./GitVcsDriver.ts";

export function worktreeBaseWarningDetail(warning: GitWorktreeBaseWarning): string {
  switch (warning.kind) {
    case "fetch-failed":
      return `Couldn't reach ${warning.remoteName}; used local ${warning.localRef}`;
    case "diverged":
      return `${warning.branch} diverged from ${warning.remoteRef}; not updated`;
    case "fast-forward-blocked":
      return `Couldn't fast-forward ${warning.branch} to ${warning.remoteName}; not updated`;
  }
}

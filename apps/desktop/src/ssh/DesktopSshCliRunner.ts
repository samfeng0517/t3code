import type { RemoteT3RunnerOptions } from "@t3tools/ssh/tunnel";

export function resolveDesktopSshCliRunner(input: {
  readonly isDevelopment: boolean;
  readonly devRemoteEntryPath: string | undefined;
  readonly nodeEngineRange: string;
  readonly appVersion: string;
  /** `T3CODE_RELEASE_BASE_URL`; a fork build has no upstream archive to fall back to. */
  readonly releaseBaseUrl: string | undefined;
}): RemoteT3RunnerOptions {
  if (input.isDevelopment && input.devRemoteEntryPath !== undefined) {
    return { nodeScriptPath: input.devRemoteEntryPath, nodeEngineRange: input.nodeEngineRange };
  }
  return {
    archiveVersion: input.appVersion,
    ...(input.releaseBaseUrl === undefined ? {} : { releaseBaseUrl: input.releaseBaseUrl }),
  };
}

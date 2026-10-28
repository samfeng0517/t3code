import { useAtomValue } from "@effect/atom-react";
import {
  T3_PROJECT_FILE_NAME,
  type CompatProjectFileSource,
  type EnvironmentId,
  type T3ProjectFile,
  type T3ProjectFileScript,
} from "@t3tools/contracts";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";
import { shouldReadCompatScripts } from "~/lib/projectFileScripts";
import { useFilesystemReadAccess } from "~/state/filesystem";
import { projectEnvironment } from "~/state/projects";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";

const NO_SCRIPTS: ReadonlyArray<T3ProjectFileScript> = [];

export interface T3ProjectFileState {
  status: "loading" | "missing" | "invalid" | "valid";
  file: T3ProjectFile | null;
  scripts: ReadonlyArray<T3ProjectFileScript>;
  /** Where `scripts` came from: t3.json, or another tool's project file when t3.json is missing. */
  source: typeof T3_PROJECT_FILE_NAME | CompatProjectFileSource;
}

export function useT3ProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): T3ProjectFileState {
  const query = useProjectFileQuery(environmentId, cwd ?? "", T3_PROJECT_FILE_NAME, cwd !== null);
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  // An oversized t3.json still exists, so it still wins over other tools' files.
  const t3ProjectFile = query.data ? "present" : isPending ? "loading" : "missing";
  const { canReadFiles } = useFilesystemReadAccess(environmentId);
  const compatSupported =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.environment.capabilities
      .compatProjectFiles === true;
  const compat = useEnvironmentQuery(
    cwd !== null &&
      shouldReadCompatScripts({
        t3ProjectFile,
        cwd,
        canReadFiles,
        serverSupportsCompatFiles: compatSupported,
      })
      ? projectEnvironment.readCompatScripts({ environmentId, input: { cwd } })
      : null,
  );
  if (contents === null) {
    const compatScripts = compat.data?.source ? compat.data : null;
    return {
      status: isPending ? "loading" : "missing",
      file: null,
      scripts: compatScripts?.scripts ?? NO_SCRIPTS,
      source: compatScripts?.source ?? T3_PROJECT_FILE_NAME,
    } as const;
  }
  const file = parseT3ProjectFile(contents);
  if (file === null) {
    return { status: "invalid", file: null, scripts: NO_SCRIPTS, source: T3_PROJECT_FILE_NAME };
  }
  return {
    status: "valid",
    file,
    scripts: file.scripts ?? NO_SCRIPTS,
    source: T3_PROJECT_FILE_NAME,
  } as const;
}

export function useT3ProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): Pick<T3ProjectFileState, "scripts" | "source"> {
  const { scripts, source } = useT3ProjectFileState(environmentId, cwd);
  return { scripts, source };
}

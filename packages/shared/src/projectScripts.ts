import type { ProjectId, ProjectScript, ServerSettings } from "@t3tools/contracts";

type ProjectScriptSettings = Pick<
  ServerSettings,
  | "defaultProjectScripts"
  | "projectScriptOverrides"
  | "projectSettingsOverrides"
  | "projectSettingsFolded"
>;

export function resolveProjectScripts(
  settings: ProjectScriptSettings,
  project: { id: ProjectId; scripts: readonly ProjectScript[] },
): readonly ProjectScript[] {
  const override = settings.projectSettingsOverrides[project.id]?.defaultProjectScripts;
  if (override !== undefined) return override;
  if (settings.projectSettingsFolded) return settings.defaultProjectScripts;
  const legacy = settings.projectScriptOverrides[project.id];
  if (legacy === null) return settings.defaultProjectScripts;
  return legacy ?? (project.scripts.length > 0 ? project.scripts : settings.defaultProjectScripts);
}

export function projectScriptsInheritDefaults(
  settings: ProjectScriptSettings,
  project: { id: ProjectId; scripts: readonly ProjectScript[] },
): boolean {
  if (settings.projectSettingsOverrides[project.id]?.defaultProjectScripts !== undefined) {
    return false;
  }
  if (settings.projectSettingsFolded) return true;
  const legacy = settings.projectScriptOverrides[project.id];
  return legacy === null || (legacy === undefined && project.scripts.length === 0);
}

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

function pathBasename(value: string): string {
  return (
    value
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ?? value
  );
}

/**
 * Besides T3 Code's own variables, scripts get the ones Superset and Orca set, so a setup script
 * written for either tool works unchanged after it is imported.
 */
export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const rootPath = input.project.cwd;
  const workspacePath = input.worktreePath || rootPath;
  const workspaceName = pathBasename(workspacePath);
  const env: Record<string, string> = {
    SUPERSET_ROOT_PATH: rootPath,
    SUPERSET_WORKSPACE_PATH: workspacePath,
    SUPERSET_WORKSPACE_NAME: workspaceName,
    ORCA_ROOT_PATH: rootPath,
    ORCA_WORKTREE_PATH: workspacePath,
    ORCA_WORKSPACE_NAME: workspaceName,
    CONDUCTOR_ROOT_PATH: rootPath,
    GHOSTX_ROOT_PATH: rootPath,
    T3CODE_PROJECT_ROOT: rootPath,
  };
  if (input.worktreePath) {
    env.T3CODE_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}

export function projectScriptMenuLabel(script: ProjectScript): string {
  const roles = [
    ...(script.runOnWorktreeCreate ? ["setup"] : []),
    ...(script.runOnSettle ? ["on settle"] : []),
    ...(script.runOnWorktreeRemove ? ["on remove"] : []),
  ];
  return roles.length === 0 ? script.name : `${script.name} (${roles.join(", ")})`;
}

export function settleProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnSettle === true) ?? null;
}

export function worktreeRemoveProjectScript(
  scripts: readonly ProjectScript[],
): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeRemove === true) ?? null;
}

/**
 * Leading spaces omit scripts from Bash history with ignorespace/ignoreboth,
 * zsh with HIST_IGNORE_SPACE, and fish. Only the first line is prefixed, so later
 * entries from multiline input may still enter history. PowerShell/PSReadLine history is not suppressed.
 */
export function projectScriptTerminalInput(command: string): string {
  return ` ${command}\r`;
}

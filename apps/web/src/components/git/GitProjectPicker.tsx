import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { GitGraphIcon } from "lucide-react";

import { useT } from "~/i18n";
import { useProjects } from "~/state/entities";
import {
  useEnvironmentMachines,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "~/state/environments";

import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { useGitTabsStore } from "./gitTabsStore";

/**
 * Projects the Git page can open, plus the environment badge to append to a project's name.
 * The badge only shows once projects span environments, matching the sidebar.
 */
export function useGitProjects() {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const machineByEnvironmentId = useEnvironmentMachines();
  const showEnvironments = new Set(projects.map((project) => project.environmentId)).size > 1;
  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const choices = projects
    .filter((project) => !project.isScratch)
    .toSorted((left, right) => left.title.localeCompare(right.title));
  const environmentBadge = (project: EnvironmentProject) =>
    showEnvironments ? (
      <ProjectEnvironmentBadge
        group={{
          memberProjects: [
            {
              ...project,
              physicalProjectKey: scopedProjectKey({
                environmentId: project.environmentId,
                projectId: project.id,
              }),
              environmentLabel: environmentLabelById.get(project.environmentId) ?? null,
            },
          ],
        }}
        primaryEnvironmentId={primaryEnvironmentId}
        machineByEnvironmentId={machineByEnvironmentId}
      />
    ) : null;
  return { choices, environmentBadge };
}

export function openGitProject(project: EnvironmentProject) {
  useGitTabsStore.getState().open({ environmentId: project.environmentId, projectId: project.id });
}

/** Shown when no tab is open: every project the user can browse. */
export function GitProjectPicker() {
  const t = useT();
  const { choices, environmentBadge } = useGitProjects();
  return (
    <Empty className="min-h-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitGraphIcon />
        </EmptyMedia>
        <EmptyTitle>{t("git.picker.title")}</EmptyTitle>
        {choices.length === 0 ? (
          <EmptyDescription>{t("git.picker.noProjects")}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {choices.length > 0 ? (
        <EmptyContent>
          <div className="flex max-h-96 w-full flex-col gap-0.5 overflow-y-auto">
            {choices.map((project) => (
              <button
                key={scopedProjectKey({
                  environmentId: project.environmentId,
                  projectId: project.id,
                })}
                type="button"
                className="flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-foreground hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => openGitProject(project)}
              >
                <ProjectFavicon project={project} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{project.title}</span>
                {environmentBadge(project)}
              </button>
            ))}
          </div>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

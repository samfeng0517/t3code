import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { FolderIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "~/i18n";
import { cn } from "~/lib/utils";

import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { PanelTabCloseButton } from "../ui/panel-tab-close-button";
import { ScrollArea } from "../ui/scroll-area";
import { openGitProject, useGitProjects } from "./GitProjectPicker";
import { useGitTabProject } from "./gitTabProject";
import { type GitTab, gitTabKey, useGitTabsStore } from "./gitTabsStore";

export function GitTabBar() {
  const t = useT();
  const tabs = useGitTabsStore((state) => state.tabs);
  const activeKey = useGitTabsStore((state) => state.activeKey);
  const { choices, environmentBadge } = useGitProjects();
  return (
    <div className="flex h-8.5 shrink-0 items-center border-b border-border bg-muted/40 px-2">
      <ScrollArea radius="none" hideScrollbars scrollFade className="min-w-0 flex-1">
        <div className="flex h-full w-max min-w-full items-center gap-1">
          {tabs.map((tab) => {
            const key = gitTabKey(tab);
            return (
              <GitTabItem
                key={key}
                tab={tab}
                active={key === activeKey}
                environmentBadge={environmentBadge}
              />
            );
          })}
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label={t("git.tabs.openProject")}
                  className="shrink-0"
                  size="icon-xs"
                  variant="ghost-muted"
                />
              }
            >
              <PlusIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="start" side="bottom" sideOffset={6}>
              {choices.length === 0 ? (
                <MenuItem disabled>{t("git.picker.noProjects")}</MenuItem>
              ) : (
                choices.map((project) => (
                  <MenuItem
                    key={gitTabKey({ environmentId: project.environmentId, projectId: project.id })}
                    onClick={() => openGitProject(project)}
                  >
                    <ProjectFavicon project={project} className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{project.title}</span>
                    {environmentBadge(project)}
                  </MenuItem>
                ))
              )}
            </MenuPopup>
          </Menu>
        </div>
      </ScrollArea>
    </div>
  );
}

function GitTabItem(props: {
  readonly tab: GitTab;
  readonly active: boolean;
  readonly environmentBadge: (project: EnvironmentProject) => ReactNode;
}) {
  const t = useT();
  const tabProject = useGitTabProject(props.tab);
  const project = tabProject.status === "ready" ? tabProject.project : null;
  const key = gitTabKey(props.tab);
  // While the project list loads the label stays empty rather than calling the project gone.
  const title =
    project?.title ?? (tabProject.status === "missing" ? t("git.tab.projectMissing") : null);
  const close = () => useGitTabsStore.getState().close(key);
  return (
    // The whole tab activates it; the inner button keeps that reachable from the keyboard.
    <div
      className={cn(
        "group/tab flex h-6 max-w-44 shrink-0 cursor-pointer items-center gap-1 rounded-md pr-2 pl-1.5 text-xs",
        props.active
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
      onClick={() => useGitTabsStore.getState().activate(key)}
    >
      <PanelTabCloseButton
        label={title === null ? t("git.tab.closeTab") : t("git.tabs.closeNamed", { title })}
        onClick={close}
      >
        {project ? (
          <ProjectFavicon project={project} className="size-3 shrink-0" />
        ) : (
          <FolderIcon className="size-3 shrink-0" />
        )}
      </PanelTabCloseButton>
      <button
        type="button"
        aria-current={props.active ? "page" : undefined}
        className="flex min-w-0 cursor-pointer items-center"
      >
        <span className="truncate">{title}</span>
      </button>
      {project ? props.environmentBadge(project) : null}
    </div>
  );
}

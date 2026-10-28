import { FolderXIcon } from "lucide-react";

import { isElectron } from "~/env";
import { useT } from "~/i18n";

import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Button } from "../ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { GitProjectPicker } from "./GitProjectPicker";
import { GitProjectView } from "./GitProjectView";
import { GitTabBar } from "./GitTabBar";
import { useGitTabProject } from "./gitTabProject";
import { type GitTab, gitTabKey, useGitTabsStore } from "./gitTabsStore";

/** The Git page: one tab per project, each browsing that project's repository history. */
export function GitPage() {
  const t = useT();
  const tabs = useGitTabsStore((state) => state.tabs);
  const activeKey = useGitTabsStore((state) => state.activeKey);
  const activeTab = tabs.find((tab) => gitTabKey(tab) === activeKey) ?? null;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="min-w-0 truncate text-sm font-medium text-foreground">
            {t("git.page.title")}
          </h1>
        </WorkspacePageHeader>
        {tabs.length === 0 ? null : <GitTabBar />}
        {activeTab === null ? (
          <GitProjectPicker />
        ) : (
          <GitTabContent key={gitTabKey(activeTab)} tab={activeTab} />
        )}
      </div>
    </SidebarInset>
  );
}

function GitTabContent(props: { readonly tab: GitTab }) {
  const t = useT();
  const tabProject = useGitTabProject(props.tab);
  if (tabProject.status === "loading") return <div className="min-h-0 flex-1" />;
  if (tabProject.status === "missing") {
    return (
      <Empty className="min-h-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderXIcon />
          </EmptyMedia>
          <EmptyTitle>{t("git.tab.projectMissing")}</EmptyTitle>
        </EmptyHeader>
        <Button
          variant="outline"
          size="sm"
          onClick={() => useGitTabsStore.getState().close(gitTabKey(props.tab))}
        >
          {t("git.tab.closeTab")}
        </Button>
      </Empty>
    );
  }
  const { project } = tabProject;
  return (
    <GitProjectView
      environmentId={project.environmentId}
      projectId={project.id}
      workspaceRoot={project.workspaceRoot}
    />
  );
}

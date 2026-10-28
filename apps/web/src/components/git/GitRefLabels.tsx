import { cn } from "~/lib/utils";

import type { GitMenuTarget, GitOpenMenu } from "./gitContextMenus";
import type { GitRefLabel } from "./gitHistoryState";

const LABEL_KIND_CLASSES: Record<GitRefLabel["kind"], string> = {
  local: "bg-success/16 text-success-foreground",
  remote: "bg-info/16 text-info-foreground",
  tag: "bg-warning/16 text-warning-foreground",
  worktree: "bg-violet-500/16 text-violet-700 dark:text-violet-300",
};

function labelMenuTarget(label: GitRefLabel, hash: string): GitMenuTarget | null {
  switch (label.kind) {
    case "local":
      return { kind: "local", name: label.name, hash };
    case "remote":
      return { kind: "remote", fullName: label.name, hash };
    case "tag":
      return { kind: "tag", name: label.name, hash };
    case "worktree":
      // Falls through to the row's commit menu.
      return null;
  }
}

export function GitRefLabels(props: {
  readonly labels: ReadonlyArray<GitRefLabel>;
  readonly hash: string;
  readonly onOpenMenu: GitOpenMenu;
}) {
  if (props.labels.length === 0) return null;
  return (
    <span className="flex min-w-0 shrink items-center gap-1 overflow-hidden">
      {props.labels.map((label) => (
        <span
          key={`${label.kind}:${label.name}`}
          className={cn(
            "inline-flex h-4.25 shrink-0 items-center rounded px-1.25 text-2xs whitespace-nowrap",
            LABEL_KIND_CLASSES[label.kind],
            label.isHead && "font-semibold",
          )}
          onContextMenu={(event) => {
            const target = labelMenuTarget(label, props.hash);
            if (target === null) return;
            event.preventDefault();
            event.stopPropagation();
            props.onOpenMenu(target, { x: event.clientX, y: event.clientY });
          }}
        >
          {label.name}
        </span>
      ))}
    </span>
  );
}

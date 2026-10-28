import type { ReactNode } from "react";

/** Title row of a top-level sidebar layer, with that layer's own actions on the right. */
export function SidebarLayerHeader(props: {
  readonly label: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex h-8 items-center gap-0.5 ps-2 pe-1">
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-muted-foreground">
        {props.label}
      </span>
      {props.children}
    </div>
  );
}

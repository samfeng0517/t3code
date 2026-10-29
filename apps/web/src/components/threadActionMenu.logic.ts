import type { ContextMenuItem } from "@t3tools/contracts";
import type { SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";

import { t as globalT, type Translate } from "../i18n";

export type ThreadActionMenuId =
  | "new-thread-on-branch"
  | "filter-by-project"
  | "project-settings"
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "auto-settle"
  | "auto-settle:enabled"
  | "auto-settle:disabled"
  | "snooze"
  | `snooze:${string}`
  | "unsnooze"
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "share-guest"
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "copy-thread"
  | "copy-thread-id"
  | "archive"
  | "delete";

export type DraftActionMenuId =
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "project-settings"
  | "discard";

export function buildDraftActionMenuItems(
  options: {
    readonly hasPath: boolean;
    readonly hasBranch: boolean;
    readonly hasProject: boolean;
  },
  t: Translate = globalT,
): ReadonlyArray<ContextMenuItem<DraftActionMenuId>> {
  return [
    {
      id: "copy",
      label: t("sidebar.menu.copy"),
      icon: "copy",
      disabled: !options.hasPath && !options.hasBranch,
      children: [
        ...(options.hasPath
          ? [{ id: "copy-path" as const, label: t("sidebar.menu.copyPath"), icon: "folder" }]
          : []),
        ...(options.hasBranch
          ? [
              {
                id: "copy-branch" as const,
                label: t("sidebar.menu.copyBranch"),
                icon: "git-branch",
              },
            ]
          : []),
      ],
    },
    ...(options.hasProject
      ? [
          {
            id: "project-settings" as const,
            label: t("sidebar.menu.projectSettings"),
            icon: "settings",
          },
        ]
      : []),
    {
      id: "discard",
      label: t("sidebar.menu.discardDraft"),
      icon: "trash",
      destructive: true,
      separatorBefore: true,
    },
  ];
}

export interface ThreadActionMenuState {
  readonly canOperate: boolean;
  readonly branch: string | null;
  readonly projectFilter: {
    readonly label: string;
    readonly isActive: boolean;
  } | null;
  readonly isPinned: boolean;
  readonly isSettled: boolean;
  readonly autoSettleEnabled: boolean;
  readonly isSnoozed: boolean;
  readonly canSnoozeNow: boolean;
  readonly isRegeneratingTitle: boolean;
  /** Archive rejects attached providers, so disable it while running. */
  readonly isRunning: boolean;
  readonly supports: {
    readonly settlement: boolean;
    readonly autoSettleOptOut: boolean;
    readonly snooze: boolean;
    readonly pinning: boolean;
    readonly titleRegeneration: boolean;
  };
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  /** Guest links need their own grant, so the caller checks it instead of `canOperate`. */
  readonly canShareWithGuest?: boolean;
}

/** Local navigation, read markers, and copying remain available to read-only clients. */
export function threadActionRequiresOperate(action: ThreadActionMenuId): boolean {
  return ![
    "new-thread-on-branch",
    "project-settings",
    "mark-unread",
    "share-guest",
    "copy",
    "copy-path",
    "copy-branch",
    "copy-thread",
    "copy-thread-id",
  ].includes(action);
}

export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
  t: Translate = globalT,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  const items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> = [
    ...(state.branch
      ? [
          {
            id: "new-thread-on-branch" as const,
            label: t("sidebar.menu.newThreadOnBranch", { branch: state.branch }),
            icon: "message-square-plus",
          },
        ]
      : []),
    ...(state.supports.pinning
      ? [
          state.isPinned
            ? { id: "unpin" as const, label: t("sidebar.menu.unpin"), icon: "pin-off" }
            : { id: "pin" as const, label: t("sidebar.menu.pin"), icon: "pin" },
        ]
      : []),
    ...(state.supports.settlement
      ? [
          state.isSettled
            ? {
                id: "unsettle" as const,
                label: t("sidebar.menu.unsettle"),
                icon: "circle-check",
              }
            : { id: "settle" as const, label: t("sidebar.menu.settle"), icon: "circle-check" },
        ]
      : []),
    ...(state.supports.snooze
      ? [
          state.isSnoozed
            ? { id: "unsnooze" as const, label: t("sidebar.menu.wake"), icon: "clock" }
            : {
                id: "snooze" as const,
                label: t("sidebar.menu.snooze"),
                icon: "clock",
                disabled: !state.canSnoozeNow,
                children: [
                  ...state.snoozePresets.map((preset) => ({
                    id: `snooze:${preset.id}` as const,
                    label: t("shell.threadMenu.snoozePreset", {
                      label: preset.label,
                      when: preset.whenLabel,
                    }),
                  })),
                  {
                    id: "snooze:custom" as const,
                    label: t("sidebar.menu.snoozeCustom"),
                    separatorBefore: state.snoozePresets.length > 0,
                  },
                ],
              },
        ]
      : []),
    {
      id: "rename",
      label: t("sidebar.menu.rename"),
      icon: "pencil",
      separatorBefore: true,
    },
    ...(state.supports.titleRegeneration
      ? [
          {
            id: "regenerate-title" as const,
            label: state.isRegeneratingTitle
              ? t("sidebar.menu.regenerating")
              : t("sidebar.menu.regenerateTitle"),
            icon: "refresh-cw",
            disabled: state.isRegeneratingTitle,
          },
        ]
      : []),
    { id: "mark-unread", label: t("sidebar.menu.markUnread"), icon: "mail-open" },
    ...(state.canShareWithGuest
      ? [
          {
            id: "share-guest" as const,
            label: t("shell.threadMenu.shareWithGuest"),
            icon: "user-plus",
          },
        ]
      : []),
    ...(state.projectFilter
      ? [
          {
            id: "filter-by-project" as const,
            label: state.projectFilter.isActive
              ? t("sidebar.menu.showAllProjects")
              : t("sidebar.menu.filterByProject", { project: state.projectFilter.label }),
            icon: "folder-tree",
          },
        ]
      : []),
    ...(state.supports.autoSettleOptOut
      ? [
          {
            id: "auto-settle" as const,
            label: t("sidebar.menu.autoSettle"),
            icon: "timer",
            children: [
              {
                id: "auto-settle:enabled" as const,
                label: t("sidebar.menu.autoSettleEnabled"),
                checked: state.autoSettleEnabled,
              },
              {
                id: "auto-settle:disabled" as const,
                label: t("sidebar.menu.autoSettleDisabled"),
                checked: !state.autoSettleEnabled,
              },
            ],
          },
        ]
      : []),
    {
      id: "copy",
      label: t("sidebar.menu.copy"),
      icon: "copy",
      separatorBefore: true,
      children: [
        { id: "copy-path", label: t("sidebar.menu.copyPath"), icon: "folder" },
        ...(state.branch
          ? [
              {
                id: "copy-branch" as const,
                label: t("sidebar.menu.copyBranch"),
                icon: "git-branch",
              },
            ]
          : []),
        { id: "copy-thread", label: t("shell.threadMenu.copyThread"), icon: "message-square" },
        { id: "copy-thread-id", label: t("sidebar.menu.copyThreadId"), icon: "hash" },
      ],
    },
    { id: "project-settings", label: t("sidebar.menu.projectSettings"), icon: "settings" },
    {
      id: "archive",
      label: t("sidebar.menu.archive"),
      icon: "archive",
      disabled: state.isRunning,
      separatorBefore: true,
    },
    {
      id: "delete",
      label: t("sidebar.menu.delete"),
      destructive: true,
      icon: "trash",
    },
  ];
  return state.canOperate
    ? items
    : items.map((item) =>
        threadActionRequiresOperate(item.id)
          ? {
              ...item,
              disabled: true,
              ...(item.children
                ? { children: item.children.map((child) => ({ ...child, disabled: true })) }
                : {}),
            }
          : item,
      );
}

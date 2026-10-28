import type { DesktopPreviewColorScheme } from "@t3tools/contracts";
import { Minus, MoreVertical, Plus as PlusIcon, RotateCcw } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuGroup,
  MenuGroupLabel,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useT, type MessageKey } from "~/i18n";

const COLOR_SCHEME_OPTIONS: ReadonlyArray<{
  value: DesktopPreviewColorScheme;
  labelKey: MessageKey;
}> = [
  { value: "system", labelKey: "workspace.preview.menu.colorScheme.system" },
  { value: "light", labelKey: "workspace.preview.menu.colorScheme.light" },
  { value: "dark", labelKey: "workspace.preview.menu.colorScheme.dark" },
];

export interface PreviewMoreMenuActions {
  readonly hardReload: () => void;
  readonly setColorScheme: (colorScheme: DesktopPreviewColorScheme) => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly resetZoom: () => void;
  readonly clearCookies: () => void;
  readonly clearCache: () => void;
  readonly openDevTools?: () => void;
  readonly toggleNativePictureInPicture?: () => void;
}

interface Props {
  enabled: boolean;
  actions: PreviewMoreMenuActions;
  zoomFactor: number;
  colorScheme: DesktopPreviewColorScheme;
  deviceToolbarVisible: boolean;
  onToggleDeviceToolbar: () => void;
  nativePictureInPicture: boolean;
  profileName: string | undefined;
  move?: { readonly label: string; readonly onMove: () => void };
  /** Moves the tab between the browser workspace and a thread's panel. */
  transfer?: { readonly label: string; readonly disabled: boolean; readonly onSelect: () => void };
}

function MenuTriggerButton() {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                type="button"
                aria-label={t("workspace.preview.menu.label")}
              />
            }
          />
        }
      >
        <MoreVertical />
      </TooltipTrigger>
      <TooltipPopup>{t("workspace.preview.menu.more")}</TooltipPopup>
    </Tooltip>
  );
}

export function PreviewMoreMenu({
  enabled,
  actions,
  zoomFactor,
  colorScheme,
  deviceToolbarVisible,
  onToggleDeviceToolbar,
  nativePictureInPicture,
  profileName,
  move,
  transfer,
}: Props) {
  const t = useT();
  const zoomLabel = `${Math.round(zoomFactor * 100)}%`;
  const disabled = !enabled;
  return (
    <Menu>
      <MenuTriggerButton />
      <MenuPopup align="end" sideOffset={6}>
        <MenuItem onClick={actions.hardReload} disabled={disabled}>
          {t("workspace.preview.menu.hardReload")}
        </MenuItem>
        {actions.openDevTools ? (
          <MenuItem onClick={actions.openDevTools} disabled={disabled}>
            {t("workspace.preview.menu.openDevTools")}
          </MenuItem>
        ) : null}
        {actions.toggleNativePictureInPicture ? (
          <MenuItem onClick={actions.toggleNativePictureInPicture} disabled={disabled}>
            {t(
              nativePictureInPicture
                ? "workspace.preview.menu.closeSeparateWindow"
                : "workspace.preview.menu.openSeparateWindow",
            )}
          </MenuItem>
        ) : null}
        {move ? <MenuItem onClick={move.onMove}>{move.label}</MenuItem> : null}
        {transfer ? (
          <MenuItem onClick={transfer.onSelect} disabled={transfer.disabled}>
            {transfer.label}
          </MenuItem>
        ) : null}
        <MenuItem onClick={onToggleDeviceToolbar} disabled={disabled}>
          {t(
            deviceToolbarVisible
              ? "workspace.preview.menu.hideDeviceToolbar"
              : "workspace.preview.menu.showDeviceToolbar",
          )}
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger disabled={disabled}>
            {t("workspace.preview.menu.appearance")}
          </MenuSubTrigger>
          <MenuSubPopup>
            <MenuRadioGroup
              value={colorScheme}
              onValueChange={(value) => actions.setColorScheme(value as DesktopPreviewColorScheme)}
            >
              {COLOR_SCHEME_OPTIONS.map((option) => (
                <MenuRadioItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>
        <MenuSeparator />
        <MenuItem
          closeOnClick={false}
          onClick={(event: React.MouseEvent) => event.preventDefault()}
          className="justify-between"
          disabled={disabled}
        >
          <span>{t("workspace.preview.menu.zoom")}</span>
          <span className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-xs"
              type="button"
              onClick={actions.zoomOut}
              aria-label={t("workspace.preview.menu.zoomOut")}
              disabled={disabled}
            >
              <Minus />
            </Button>
            <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
              {zoomLabel}
            </span>
            <Button
              variant="outline"
              size="icon-xs"
              type="button"
              onClick={actions.zoomIn}
              aria-label={t("workspace.preview.menu.zoomIn")}
              disabled={disabled}
            >
              <PlusIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={actions.resetZoom}
              aria-label={t("workspace.preview.menu.resetZoom")}
              disabled={disabled}
            >
              <RotateCcw />
            </Button>
          </span>
        </MenuItem>
        <MenuSeparator />
        <MenuGroup>
          {profileName ? (
            <MenuGroupLabel className="max-w-64">
              <span className="block truncate">
                {t("workspace.preview.menu.profile", { profile: profileName })}
              </span>
            </MenuGroupLabel>
          ) : null}
          <MenuItem onClick={actions.clearCookies}>
            {t("workspace.preview.menu.clearCookies")}
          </MenuItem>
          <MenuItem onClick={actions.clearCache}>{t("workspace.preview.menu.clearCache")}</MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

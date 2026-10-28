import { useT, type MessageKey } from "../../i18n";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import {
  SETTINGS_SECTION_LABELS,
  settingsSectionMessageKey,
  type SettingsPath,
} from "./settingsSearch";

function isSettingsSectionPath(pathname: string): pathname is SettingsPath {
  return Object.hasOwn(SETTINGS_SECTION_LABELS, pathname);
}

function settingsBreadcrumbMessageKey(pathname: string): MessageKey | null {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  if (normalizedPathname === "/settings/open-source-licenses") {
    return "settings.breadcrumb.openSourceLicenses";
  }
  return isSettingsSectionPath(normalizedPathname)
    ? settingsSectionMessageKey(normalizedPathname)
    : null;
}

export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
  const t = useT();
  const sectionKey = settingsBreadcrumbMessageKey(pathname);

  return (
    <WorkspaceBreadcrumb ariaLabel={t("settings.breadcrumb.ariaLabel")}>
      {sectionKey ? (
        <>
          <WorkspaceBreadcrumbItem>{t("common.settings")}</WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
        </>
      ) : null}
      <WorkspaceBreadcrumbItem current className="truncate">
        {sectionKey ? t(sectionKey) : t("common.settings")}
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
}

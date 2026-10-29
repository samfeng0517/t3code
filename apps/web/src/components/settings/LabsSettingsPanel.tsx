import { useAuth } from "@clerk/react";
import { Link } from "@tanstack/react-router";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { useT } from "~/i18n";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { LegacyFeaturesSection } from "./SettingsPanels";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** Features still settling in, and legacy behavior kept for people who rely on it. */
export function LabsSettingsPanel() {
  const t = useT();
  return (
    <SettingsPageContainer>
      <SettingsSection id="beta" title={t("settingsMisc.labs.beta")}>
        {/* Clerk is only mounted when this build has T3 Connect. */}
        {hasCloudPublicConfig() ? <GuestLinksRowWithSignIn /> : <GuestLinksRow />}
        <LinkedEnvironmentsRow />
      </SettingsSection>
      <LegacyFeaturesSection />
    </SettingsPageContainer>
  );
}

/** Signed out of T3 Connect, the row offers to sign in instead of its switch. */
function GuestLinksRowWithSignIn() {
  const t = useT();
  const { isSignedIn } = useAuth();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  // `isSignedIn` is undefined until Clerk loads.
  if (isSignedIn !== false) return <GuestLinksRow />;
  return (
    <SettingsRow
      {...searchableSetting("guest-links", t)}
      description={t("settingsMisc.labs.guestLinks.signedOutDescription")}
      control={
        <Button size="sm" variant="outline" onClick={openAuthPrompt}>
          {t("settingsMisc.labs.signIn")}
        </Button>
      }
    />
  );
}

function GuestLinksRow() {
  const t = useT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("guest-links", t)}
      settingKeys={["guestSharingEnabled"]}
      description={
        <>
          {t("settingsMisc.labs.guestLinks.descriptionBefore")}{" "}
          <Link to="/settings/access" className="underline underline-offset-2">
            {t("settingsMisc.labs.guestLinks.sharingAccess")}
          </Link>
          {t("settingsMisc.labs.guestLinks.descriptionAfter")}
        </>
      }
      control={
        <ScopedSwitch
          settingKeys={["guestSharingEnabled"]}
          checked={settings.guestSharingEnabled}
          onCheckedChange={(checked) => updateSettings({ guestSharingEnabled: Boolean(checked) })}
          aria-label={t("settingsMisc.labs.guestLinks.ariaLabel")}
        />
      }
    />
  );
}

function LinkedEnvironmentsRow() {
  const t = useT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("linked-environments-beta", t)}
      settingKeys={["linkedEnvironmentsEnabled"]}
      description={
        <>
          {t("settingsMisc.labs.linked.descriptionBefore")}{" "}
          <Link to="/settings/connections" className="underline underline-offset-2">
            {t("settingsMisc.labs.linked.connections")}
          </Link>
          {t("settingsMisc.labs.linked.descriptionAfter")}
        </>
      }
      control={
        <ScopedSwitch
          settingKeys={["linkedEnvironmentsEnabled"]}
          checked={settings.linkedEnvironmentsEnabled}
          onCheckedChange={(checked) =>
            updateSettings({ linkedEnvironmentsEnabled: Boolean(checked) })
          }
          aria-label={t("settingsMisc.labs.linked.ariaLabel")}
        />
      }
    />
  );
}

import type { CSSProperties } from "react";
import { useState } from "react";
import {
  DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
  DEFAULT_UNIFIED_SETTINGS,
  type EffortDisplay,
  type EnvironmentIdentificationMode,
  MAX_APPEARANCE_CONTRAST,
  MAX_GLASS_OPACITY,
  MAX_PANEL_ANIMATION_DURATION_MS,
  MIN_APPEARANCE_CONTRAST,
  MIN_GLASS_OPACITY,
  MIN_PANEL_ANIMATION_DURATION_MS,
} from "@t3tools/contracts/settings";
import {
  resolveSidebarStageBackdropVariant,
  type SidebarStageBackdropVariant,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { useCustomThemes } from "../../hooks/useCustomThemes";
import { useTheme } from "../../hooks/useTheme";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { ThemeLibrary } from "./ThemeSettings";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { AdvancedSettings } from "./AdvancedSettings";
import { PanelAnimationsPreview } from "./PanelAnimationsPreview";
import { TypographySection } from "./TypographySettings";
import { type Translate, useT } from "../../i18n";

// The default "artwork" follows the running channel, so it is labeled as that channel's art,
// or as "None" on Latest. The other channel's art is offered as a fixed choice.
function environmentIdentificationOptions(
  stageVariant: SidebarStageBackdropVariant | null,
  t: Translate,
): ReadonlyArray<readonly [EnvironmentIdentificationMode, string]> {
  const pill = t("settings.appearance.environmentIdentification.option.pill");
  const none = t("settings.appearance.environmentIdentification.option.none");
  if (stageVariant === "dev") {
    return [
      ["artwork", "Dev artwork"],
      ["nightly-artwork", "Nightly artwork"],
      ["pill", pill],
      ["none", none],
    ];
  }
  if (stageVariant === "nightly") {
    return [
      ["artwork", "Nightly artwork"],
      ["dev-artwork", "Dev artwork"],
      ["pill", pill],
      ["none", none],
    ];
  }
  return [
    ["artwork", none],
    ["nightly-artwork", "Nightly artwork"],
    ["dev-artwork", "Dev artwork"],
  ];
}

function environmentIdentificationFallbackLabel(
  mode: EnvironmentIdentificationMode,
  t: Translate,
): string {
  switch (mode) {
    case "artwork":
      return t("settings.appearance.environmentIdentification.option.artwork");
    case "nightly-artwork":
      return "Nightly artwork";
    case "dev-artwork":
      return "Dev artwork";
    case "pill":
      return t("settings.appearance.environmentIdentification.option.pill");
    case "none":
      return t("settings.appearance.environmentIdentification.option.none");
  }
}

const EFFORT_DISPLAY_LABELS: Record<EffortDisplay, string> = {
  label: "Word",
  bars: "Bars",
};

export function AppearanceSettingsPanel() {
  const t = useT();
  const {
    appearanceMode,
    refreshTheme,
    resolvedTheme,
    setAppearanceMode,
    setTheme,
    setThemeHalf,
    theme,
    themeHalves,
  } = useTheme();
  const customThemes = useCustomThemes();
  const [isImportThemeOpen, setIsImportThemeOpen] = useState(false);
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const environmentStageLabel = useEnvironmentStageLabel();
  const environmentStageVariant = resolveSidebarStageBackdropVariant(environmentStageLabel);
  const environmentIdentificationOptionList = environmentIdentificationOptions(
    environmentStageVariant,
    t,
  );
  const environmentIdentificationLabel =
    environmentIdentificationOptionList.find(
      ([value]) => value === settings.environmentIdentificationMode,
    )?.[1] ?? environmentIdentificationFallbackLabel(settings.environmentIdentificationMode, t);
  const glassOpacityRatio =
    (settings.glassOpacity - MIN_GLASS_OPACITY) / (MAX_GLASS_OPACITY - MIN_GLASS_OPACITY);
  const glassOpacitySliderStyle = {
    "--settings-slider-progress": `${glassOpacityRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - glassOpacityRatio}rem`,
  } as CSSProperties;
  const appearanceContrastRatio =
    (settings.appearanceContrast - MIN_APPEARANCE_CONTRAST) /
    (MAX_APPEARANCE_CONTRAST - MIN_APPEARANCE_CONTRAST);
  const appearanceContrastSliderStyle = {
    "--settings-slider-progress": `${appearanceContrastRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - appearanceContrastRatio}rem`,
  } as CSSProperties;
  const panelAnimationDurationRatio =
    (settings.panelAnimationDurationMs - MIN_PANEL_ANIMATION_DURATION_MS) /
    (MAX_PANEL_ANIMATION_DURATION_MS - MIN_PANEL_ANIMATION_DURATION_MS);
  const panelAnimationDurationSliderStyle = {
    "--settings-slider-progress": `${panelAnimationDurationRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - panelAnimationDurationRatio}rem`,
  } as CSSProperties;

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="appearance"
        title={t("settings.appearance.section.themes")}
        variant="plain"
        hideTitle
      >
        <div id={searchableSetting("theme").id}>
          <ThemeLibrary
            appearanceMode={appearanceMode}
            customThemes={customThemes}
            initialAppearance={resolvedTheme}
            refreshTheme={refreshTheme}
            isImportOpen={isImportThemeOpen}
            setAppearanceMode={setAppearanceMode}
            setTheme={setTheme}
            setThemeHalf={setThemeHalf}
            theme={theme}
            themeHalves={themeHalves}
            onImportOpenChange={setIsImportThemeOpen}
          />
        </div>
      </SettingsSection>

      <SettingsSection id="appearance-interface" title={t("settings.appearance.section.interface")}>
        <SettingsRow
          {...searchableSetting("setting-appearance-contrast")}
          title={t("settings.appearance.contrast.title")}
          description={t("settings.appearance.contrast.description")}
          resetAction={
            settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast ? (
              <SettingResetButton
                label={t("settings.appearance.contrast.resetLabel")}
                onClick={() =>
                  updateSettings({
                    appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="appearance-contrast"
              >
                {settings.appearanceContrast}%
              </output>
              <input
                aria-label={t("settings.appearance.contrast.title")}
                className="settings-slider min-w-0 flex-1"
                id="appearance-contrast"
                max={MAX_APPEARANCE_CONTRAST}
                min={MIN_APPEARANCE_CONTRAST}
                onChange={(event) => {
                  const appearanceContrast = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(appearanceContrast) &&
                    appearanceContrast >= MIN_APPEARANCE_CONTRAST &&
                    appearanceContrast <= MAX_APPEARANCE_CONTRAST
                  ) {
                    updateSettings({ appearanceContrast });
                  }
                }}
                step={5}
                style={appearanceContrastSliderStyle}
                type="range"
                value={settings.appearanceContrast}
              />
            </div>
          }
        />

        <SettingsRow
          {...searchableSetting("setting-glass-opacity")}
          title={t("settings.appearance.glassOpacity.title")}
          description={t("settings.appearance.glassOpacity.description")}
          resetAction={
            settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? (
              <SettingResetButton
                label={t("settings.appearance.glassOpacity.resetLabel")}
                onClick={() =>
                  updateSettings({ glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="glass-opacity"
              >
                {settings.glassOpacity}%
              </output>
              <input
                aria-label={t("settings.appearance.glassOpacity.title")}
                className="settings-slider min-w-0 flex-1"
                id="glass-opacity"
                max={MAX_GLASS_OPACITY}
                min={MIN_GLASS_OPACITY}
                onChange={(event) => {
                  const glassOpacity = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(glassOpacity) &&
                    glassOpacity >= MIN_GLASS_OPACITY &&
                    glassOpacity <= MAX_GLASS_OPACITY
                  ) {
                    updateSettings({ glassOpacity });
                  }
                }}
                step={5}
                style={glassOpacitySliderStyle}
                type="range"
                value={settings.glassOpacity}
              />
            </div>
          }
        />

        <SettingsRow
          {...searchableSetting("chat-width")}
          title={t("settings.appearance.chatWidth.title")}
          description={t("settings.appearance.chatWidth.description")}
          resetAction={
            settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth ? (
              <SettingResetButton
                label={t("settings.appearance.chatWidth.resetLabel")}
                onClick={() => updateSettings({ chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth })}
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.chatWidth}
                onValueChange={(value) => {
                  if (value === "comfortable" || value === "wide" || value === "full")
                    updateSettings({ chatWidth: value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={t("settings.appearance.chatWidth.title")}
                >
                  <SelectValue>
                    {t(`settings.appearance.chatWidth.option.${settings.chatWidth}`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="comfortable">
                    {t("settings.appearance.chatWidth.option.comfortableDefault")}
                  </SelectItem>
                  <SelectItem value="wide">
                    {t("settings.appearance.chatWidth.option.wide")}
                  </SelectItem>
                  <SelectItem value="full">
                    {t("settings.appearance.chatWidth.option.full")}
                  </SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <SettingsRow
          {...searchableSetting("effort-display")}
          description="Show reasoning effort in the composer as its name, such as High, or as bars."
          resetAction={
            settings.effortDisplay !== DEFAULT_UNIFIED_SETTINGS.effortDisplay ? (
              <SettingResetButton
                label="effort display"
                onClick={() =>
                  updateSettings({ effortDisplay: DEFAULT_UNIFIED_SETTINGS.effortDisplay })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.effortDisplay}
                onValueChange={(value) => {
                  if (value === "bars" || value === "label")
                    updateSettings({ effortDisplay: value });
                }}
              >
                <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Effort display">
                  <SelectValue>{EFFORT_DISPLAY_LABELS[settings.effortDisplay]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="label">Word (default)</SelectItem>
                  <SelectItem value="bars">Bars</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <SettingsRow
          {...searchableSetting("math-rendering")}
          title={t("settings.appearance.mathRendering.title")}
          description={t("settings.appearance.mathRendering.description")}
          resetAction={
            settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled ? (
              <SettingResetButton
                label={t("settings.appearance.mathRendering.resetLabel")}
                onClick={() =>
                  updateSettings({
                    mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.mathRenderingEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ mathRenderingEnabled: Boolean(checked) })
              }
              aria-label={t("settings.appearance.mathRendering.title")}
            />
          }
        />
        <AdvancedSettings
          targetIds={[
            searchableSetting("panel-animations").id,
            searchableSetting("environment-identification").id,
            // Environment identification's search result lands on this section.
            "appearance-interface",
            searchableSetting("composer-context").id,
          ]}
        >
          <SettingsRow
            {...searchableSetting("panel-animations")}
            title={t("settings.appearance.panelAnimations.title")}
            description={t("settings.appearance.panelAnimations.description")}
            control={
              <div className="grid w-full grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:w-auto sm:grid-cols-[7rem_13rem] sm:gap-4">
                <PanelAnimationsPreview durationMs={settings.panelAnimationDurationMs} />
                <div className="flex w-full items-center gap-3">
                  <output
                    className="min-w-16 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                    htmlFor="panel-animation-duration"
                  >
                    {settings.panelAnimationDurationMs} ms
                  </output>
                  <input
                    aria-label={t("settings.appearance.panelAnimations.ariaLabel")}
                    className="settings-slider min-w-0 flex-1"
                    id="panel-animation-duration"
                    max={MAX_PANEL_ANIMATION_DURATION_MS}
                    min={MIN_PANEL_ANIMATION_DURATION_MS}
                    onChange={(event) => {
                      const panelAnimationDurationMs = Number(event.currentTarget.value);
                      if (
                        Number.isInteger(panelAnimationDurationMs) &&
                        panelAnimationDurationMs >= MIN_PANEL_ANIMATION_DURATION_MS &&
                        panelAnimationDurationMs <= MAX_PANEL_ANIMATION_DURATION_MS
                      ) {
                        updateSettings({ panelAnimationDurationMs });
                      }
                    }}
                    step={25}
                    style={panelAnimationDurationSliderStyle}
                    type="range"
                    value={settings.panelAnimationDurationMs}
                  />
                </div>
              </div>
            }
            resetAction={
              settings.panelAnimationDurationMs !==
              DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs ? (
                <SettingResetButton
                  label={t("settings.appearance.panelAnimations.resetLabel")}
                  onClick={() =>
                    updateSettings({
                      panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs,
                    })
                  }
                />
              ) : null
            }
          />
          <SettingsRow
            {...searchableSetting("environment-identification")}
            title={t("settings.appearance.environmentIdentification.title")}
            description={
              environmentStageVariant
                ? t("settings.appearance.environmentIdentification.description")
                : "Show Dev or Nightly artwork in the sidebar header."
            }
            resetAction={
              settings.environmentIdentificationMode !== DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE ? (
                <SettingResetButton
                  label={t("settings.appearance.environmentIdentification.resetLabel")}
                  onClick={() =>
                    updateSettings({
                      environmentIdentificationMode: DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.environmentIdentificationMode}
                onValueChange={(value) => {
                  const option = environmentIdentificationOptionList.find(
                    ([optionValue]) => optionValue === value,
                  );
                  if (option) updateSettings({ environmentIdentificationMode: option[0] });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={t("settings.appearance.environmentIdentification.title")}
                >
                  <SelectValue>{environmentIdentificationLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {environmentIdentificationOptionList.map(([value, label]) => (
                    <SelectItem hideIndicator key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            {...searchableSetting("composer-context")}
            title={t("settings.appearance.composerContext.title")}
            description={t("settings.appearance.composerContext.description")}
            resetAction={
              settings.persistComposerContextStrip !==
              DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip ? (
                <SettingResetButton
                  label={t("settings.appearance.composerContext.resetLabel")}
                  onClick={() =>
                    updateSettings({
                      persistComposerContextStrip:
                        DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.persistComposerContextStrip}
                onCheckedChange={(checked) =>
                  updateSettings({ persistComposerContextStrip: Boolean(checked) })
                }
                aria-label={t("settings.appearance.composerContext.ariaLabel")}
              />
            }
          />
        </AdvancedSettings>
      </SettingsSection>

      <TypographySection />
    </SettingsPageContainer>
  );
}

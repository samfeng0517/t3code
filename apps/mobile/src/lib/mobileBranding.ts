export type MobileStageLabel = "Dev" | "Nightly";

// Store builds carry no stage badge and show the bare product name.
export function resolveMobileStageLabel(appVariant: unknown): MobileStageLabel | null {
  if (appVariant === "development") return "Dev";
  if (appVariant === "preview") return "Nightly";
  return null;
}

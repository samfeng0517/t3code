import { t as globalT, type Translate } from "~/i18n";
import {
  connectionStatusText,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";

export interface SavedCloudEnvironmentConnectionPresentation {
  readonly buttonLabel: string;
  readonly statusText: string;
  readonly tone: "connected" | "connecting" | "error" | "idle";
}

export function presentSavedCloudEnvironmentConnection(
  connection: EnvironmentConnectionPresentation,
  t: Translate = globalT,
): SavedCloudEnvironmentConnectionPresentation {
  switch (connection.phase) {
    case "connected":
      return {
        buttonLabel: t("files.cloud.status.connected"),
        statusText: connectionStatusText(connection),
        tone: "connected",
      };
    case "connecting":
      return {
        buttonLabel: t("files.cloud.status.connecting"),
        statusText: connectionStatusText(connection),
        tone: "connecting",
      };
    case "reconnecting":
      return {
        buttonLabel: t("files.cloud.status.reconnecting"),
        statusText: connectionStatusText(connection),
        tone: "connecting",
      };
    case "unsupported":
      return {
        buttonLabel: t("files.cloud.status.unsupported"),
        statusText: connectionStatusText(connection),
        tone: "idle",
      };
    case "error":
      return {
        buttonLabel: t("files.cloud.status.error"),
        statusText: connectionStatusText(connection),
        tone: "error",
      };
    case "offline":
      return {
        buttonLabel: t("files.cloud.status.offline"),
        statusText: connectionStatusText(connection),
        tone: "idle",
      };
    case "available":
      return {
        buttonLabel: t("files.cloud.status.notConnected"),
        statusText: connectionStatusText(connection),
        tone: "idle",
      };
  }
}

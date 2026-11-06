import { createFileRoute } from "@tanstack/react-router";

import { AssistantSettingsPanel } from "../components/settings/AssistantSettings";

export const Route = createFileRoute("/_chat/settings/assistant")({
  component: AssistantSettingsPanel,
});

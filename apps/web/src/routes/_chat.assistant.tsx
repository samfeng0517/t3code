import { createFileRoute } from "@tanstack/react-router";

import { AssistantPage } from "../components/assistant/AssistantPage";

export const Route = createFileRoute("/_chat/assistant")({
  component: AssistantPage,
});

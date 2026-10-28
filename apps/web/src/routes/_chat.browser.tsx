import { createFileRoute } from "@tanstack/react-router";

import { BrowserWorkspacePage } from "../components/preview/BrowserWorkspacePage";

export const Route = createFileRoute("/_chat/browser")({
  component: BrowserWorkspacePage,
});

import { createFileRoute } from "@tanstack/react-router";

import { GitPage } from "../components/git/GitPage";

export const Route = createFileRoute("/_chat/git")({
  component: GitPage,
});

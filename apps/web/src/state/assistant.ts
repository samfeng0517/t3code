import { createAssistantEnvironmentAtoms } from "@t3tools/client-runtime/state/assistant";

import { connectionAtomRuntime } from "../connection/runtime";

export const assistantEnvironment = createAssistantEnvironmentAtoms(connectionAtomRuntime);

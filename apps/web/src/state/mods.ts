import { createModEnvironmentAtoms } from "@t3tools/client-runtime/state/mods";

import { connectionAtomRuntime } from "../connection/runtime";

export const modEnvironment = createModEnvironmentAtoms(connectionAtomRuntime);

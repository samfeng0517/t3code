import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ModPaneId,
  ModSurfaceAction,
  ModSurfaceSite,
  ModUiButton,
  ModUiInput,
  ModUiSelect,
  ThreadId,
} from "@t3tools/contracts";
import { useState } from "react";

import { modEnvironment } from "~/state/mods";
import { useAtomCommand } from "~/state/use-atom-command";

/** Sends a person's presses, picks and typing back to the mods running in the thread's session. */
export function useModActions(environmentId: EnvironmentId, threadId: ThreadId) {
  const act = useAtomCommand(modEnvironment.act);
  // A field's edits fail quietly: a stopped session would otherwise raise a
  // toast per keystroke. Its submit still reports.
  const actQuietly = useAtomCommand(modEnvironment.act, { reportFailure: false });
  const permitted = useAtomValue(modEnvironment.act.permissionAtom(environmentId));
  // One press or pick at a time per view: a second would name a drawing the first may replace.
  const [pending, setPending] = useState(false);
  const run = async (action: ModSurfaceAction): Promise<boolean> => {
    if (pending) return false;
    setPending(true);
    const result = await act({ environmentId, input: { threadId, action } }).finally(() =>
      setPending(false),
    );
    return result._tag === "Success" && result.value.handled;
  };
  return {
    canAct: permitted && !pending,
    // Typing never waits on a press: each field orders its own edits.
    canEdit: permitted,
    press: (site: ModSurfaceSite, button: ModUiButton) =>
      run({ type: "press", site, plugin: button.plugin, handle: button.handle, key: button.key }),
    /** Resolves false when the pick did not reach the mod, so the picker shows the drawn value again. */
    pick: (site: ModSurfaceSite, select: ModUiSelect, value: string) =>
      run({
        type: "select",
        site,
        plugin: select.plugin,
        handle: select.handle,
        key: select.key,
        value,
      }),
    edit: (site: ModSurfaceSite, input: ModUiInput, kind: "change" | "submit", value: string) =>
      (kind === "change" ? actQuietly : act)({
        environmentId,
        input: {
          threadId,
          action: {
            type: "input",
            site,
            plugin: input.plugin,
            handle: input.handle,
            key: input.key,
            kind,
            value,
          },
        },
      }),
    closePane: (paneId: ModPaneId) => run({ type: "close-pane", paneId }),
  };
}

export type ModActions = ReturnType<typeof useModActions>;

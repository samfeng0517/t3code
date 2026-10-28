import * as Context from "effect/Context";

/**
 * Upstream self-update paths (electron-updater feed, GitHub Release CLI archives, npm `t3`) would
 * replace this fork, so they are gated on this switch rather than deleted, keeping upstream merges small.
 * A source constant, not an env flag: a stray env var must not re-enable upstream installs.
 */
export const APP_SELF_UPDATE_ENABLED: boolean = false;

export const APP_SELF_UPDATE_DISABLED_MESSAGE =
  "This fork build of T3 Code does not update itself from upstream releases. Pull the fork and rebuild it to update.";

/** Lets tests exercise the upstream update paths; production code reads the constant default. */
export const AppSelfUpdateEnabled = Context.Reference<boolean>(
  "@t3tools/shared/appSelfUpdate/AppSelfUpdateEnabled",
  { defaultValue: () => APP_SELF_UPDATE_ENABLED },
);

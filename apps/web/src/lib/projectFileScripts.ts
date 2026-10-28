/**
 * Another tool's project file is only asked for when the checkout has no t3.json (a t3.json, even
 * an invalid one, wins) and the server can answer; older servers lack the request entirely.
 */
export function shouldReadCompatScripts(input: {
  readonly t3ProjectFile: "loading" | "missing" | "present";
  readonly cwd: string | null;
  readonly canReadFiles: boolean;
  readonly serverSupportsCompatFiles: boolean;
}): boolean {
  return (
    input.t3ProjectFile === "missing" &&
    input.cwd !== null &&
    input.canReadFiles &&
    input.serverSupportsCompatFiles
  );
}

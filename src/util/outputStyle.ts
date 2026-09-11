import pc from "picocolors";

/** The marker every mutating command prefixes a would-be action with under --dry-run. */
export function dryRunTag(): string {
  return pc.dim("[dry-run]");
}

/** A literal shell command meant to be copied and run, styled distinctly from surrounding prose. */
export function commandHint(command: string): string {
  return pc.cyan(command);
}

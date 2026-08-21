import pc from "picocolors";

/** Human-readable description of where a marketplace add/remove is targeting, for log messages. */
export function describeMarketplaceTarget(moduleName: string | undefined): string {
  return moduleName === undefined ? "the global registry" : `module '${pc.bold(moduleName)}'`;
}

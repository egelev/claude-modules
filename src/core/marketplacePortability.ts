import pc from "picocolors";
import { MarketplaceSource } from "./types.js";
import { Logger } from "../util/Logger.js";

/**
 * MarketplaceSource is treated as opaque everywhere else — stored and compared verbatim, never
 * interpreted. This is the one narrow peek inside, and it exists for a single purpose: a module is
 * meant to be portable, and a marketplace resolved from a local path (or any non-`github` source)
 * is machine-specific and won't mean anything on another machine.
 *
 * Shared by `plugin install` (which can resolve one out of Claude Code's own cache) and
 * `create --from-scope` (which can copy one straight out of a settings.json).
 */
export function warnIfNonPortableMarketplace(logger: Logger, marketplace: string, source: MarketplaceSource): void {
  const kind = (source as { source?: { source?: string } })?.source?.source;
  if (kind === undefined || kind === "github") return;

  logger.warn(
    `Marketplace '${pc.bold(marketplace)}' has a '${kind}' source.\n  ` +
      `This is machine-specific and won't travel with this module to another machine.`
  );
}

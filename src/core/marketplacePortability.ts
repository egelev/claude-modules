import pc from "picocolors";
import { MarketplaceSource } from "./types.js";
import { classifyMarketplaceSource, marketplacePortability } from "./marketplaceSpec.js";
import { Logger } from "../util/Logger.js";

/**
 * MarketplaceSource is treated as opaque everywhere else — stored and compared verbatim, never
 * interpreted. This is the one narrow peek inside, and it exists for a single purpose: a module is
 * meant to be portable, and a marketplace resolved from a local path (a `directory`, `file`, or
 * `file://` git source) is machine-specific and won't mean anything on another machine. An
 * unrecognized shape is treated the same as a known-non-portable one — see `marketplacePortability`
 * — rather than assumed safe just because this tool doesn't know what it is.
 *
 * Shared by `plugin install` (which can resolve one out of Claude Code's own cache),
 * `create --from-scope` (which can copy one straight out of a settings.json), and `export`.
 */
export function warnIfNonPortableMarketplace(logger: Logger, marketplace: string, source: MarketplaceSource): void {
  const portability = marketplacePortability(source);
  if (portability === "portable") return;

  const description = portability === "unrecognized" ? "an unrecognized" : `a '${classifyMarketplaceSource(source)}'`;
  logger.warn(
    `Marketplace '${pc.bold(marketplace)}' has ${description} source.\n  ` +
      `This is machine-specific and won't travel with this module to another machine.`
  );
}

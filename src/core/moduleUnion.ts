import { EffectiveModule, MarketplaceSource } from "./types.js";
import { MarketplaceConflictError } from "../util/errors.js";
import { deepEqualJson } from "../util/deepEqualJson.js";

export interface ResolvedModules {
  /** Plugin keys ("<plugin>@<marketplace>") that should be enabled — the union of all selected modules. */
  enabledPluginNames: Set<string>;
  extraKnownMarketplaces: Record<string, MarketplaceSource>;
}

/**
 * Unions a set of already-flattened (composition-resolved) modules into enabled plugins and known
 * marketplaces, throwing `MarketplaceConflictError` if two entries declare the same marketplace name
 * with different sources. Shared by `ModuleResolver.resolve()` (unions CLI-supplied module names)
 * and `CompositionResolver.resolveEffective()` (unions a module's composed siblings) — same
 * union-with-conflict-detection semantics at both levels. Lives in its own module, separate from
 * both callers, so neither of them has to import the other.
 */
export function unionEffectiveModules(
  entries: readonly { name: string; module: EffectiveModule }[]
): ResolvedModules {
  const enabledPluginNames = new Set<string>();
  const extraKnownMarketplaces: Record<string, MarketplaceSource> = {};
  const marketplaceOwner = new Map<string, string>();

  for (const { name, module } of entries) {
    for (const [pluginKey, enabled] of Object.entries(module.enabledPlugins)) {
      if (enabled) enabledPluginNames.add(pluginKey);
    }

    for (const [marketplaceName, source] of Object.entries(module.extraKnownMarketplaces)) {
      const owner = marketplaceOwner.get(marketplaceName);
      if (owner === undefined) {
        extraKnownMarketplaces[marketplaceName] = source;
        marketplaceOwner.set(marketplaceName, name);
      } else if (!deepEqualJson(extraKnownMarketplaces[marketplaceName], source)) {
        throw new MarketplaceConflictError(marketplaceName, owner, name);
      }
    }
  }

  return { enabledPluginNames, extraKnownMarketplaces };
}

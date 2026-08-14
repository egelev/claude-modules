import { ProfileStore } from "./ProfileStore.js";
import { MarketplaceSource } from "./types.js";
import { MarketplaceConflictError } from "../util/errors.js";
import { deepEqualJson } from "../util/deepEqualJson.js";
import { Logger } from "../util/Logger.js";

export interface ResolvedProfiles {
  /** Plugin keys ("<plugin>@<marketplace>") that should be enabled — the union of all selected profiles. */
  enabledPluginNames: Set<string>;
  extraKnownMarketplaces: Record<string, MarketplaceSource>;
}

/** Loads a set of named profiles and computes their union: enabled plugins and known marketplaces. */
export class ProfileResolver {
  constructor(
    private readonly profileStore: ProfileStore,
    private readonly logger: Logger
  ) {}

  async resolve(profileNames: readonly string[]): Promise<ResolvedProfiles> {
    const enabledPluginNames = new Set<string>();
    const extraKnownMarketplaces: Record<string, MarketplaceSource> = {};
    const marketplaceOwner = new Map<string, string>();

    for (const profileName of profileNames) {
      const profile = await this.profileStore.load(profileName);

      for (const [pluginKey, enabled] of Object.entries(profile.enabledPlugins)) {
        if (enabled) enabledPluginNames.add(pluginKey);
      }

      for (const [marketplaceName, source] of Object.entries(profile.extraKnownMarketplaces)) {
        const owner = marketplaceOwner.get(marketplaceName);
        if (owner === undefined) {
          extraKnownMarketplaces[marketplaceName] = source;
          marketplaceOwner.set(marketplaceName, profileName);
        } else if (!deepEqualJson(extraKnownMarketplaces[marketplaceName], source)) {
          throw new MarketplaceConflictError(marketplaceName, owner, profileName);
        }
      }
    }

    if (enabledPluginNames.size === 0) {
      this.logger.warn(
        `Selected profile(s) [${profileNames.join(", ")}] enable no plugins — every plugin in the target scope will be disabled.`
      );
    }

    return { enabledPluginNames, extraKnownMarketplaces };
  }

  /**
   * Like `resolve`, but only unions enabled plugin names — no marketplace-conflict checking. Used
   * by `disable`, which never touches marketplaces and shouldn't fail on a conflict that's
   * irrelevant to it.
   */
  async resolveEnabledPluginNames(profileNames: readonly string[]): Promise<Set<string>> {
    const enabledPluginNames = new Set<string>();

    for (const profileName of profileNames) {
      const profile = await this.profileStore.load(profileName);
      for (const [pluginKey, enabled] of Object.entries(profile.enabledPlugins)) {
        if (enabled) enabledPluginNames.add(pluginKey);
      }
    }

    if (enabledPluginNames.size === 0) {
      this.logger.warn(`Selected profile(s) [${profileNames.join(", ")}] enable no plugins — nothing to disable.`);
    }

    return enabledPluginNames;
  }
}

import { ClaudeSettings } from "./types.js";
import { ResolvedProfiles } from "./ProfileResolver.js";

/**
 * Computes settings.json mutations for enabling/disabling plugins. Plugin keys are never removed,
 * only flipped between true/false; marketplaces are only ever added, never touched by disabling.
 */
export class SettingsApplier {
  apply(existing: ClaudeSettings, union: ResolvedProfiles): ClaudeSettings {
    const enabledPlugins: Record<string, boolean> = {};
    for (const pluginKey of Object.keys(existing.enabledPlugins ?? {})) {
      enabledPlugins[pluginKey] = union.enabledPluginNames.has(pluginKey);
    }
    for (const pluginKey of union.enabledPluginNames) {
      enabledPlugins[pluginKey] = true;
    }

    const extraKnownMarketplaces = { ...(existing.extraKnownMarketplaces ?? {}) };
    for (const [marketplaceName, source] of Object.entries(union.extraKnownMarketplaces)) {
      if (!(marketplaceName in extraKnownMarketplaces)) {
        extraKnownMarketplaces[marketplaceName] = source;
      }
    }

    return { ...existing, enabledPlugins, extraKnownMarketplaces };
  }

  /**
   * Flips the given plugin keys to disabled. Only touches keys already present in `existing` —
   * a plugin never enabled in this scope has nothing to disable, so no phantom `false` entry is
   * created for it. Marketplaces are left untouched.
   */
  disable(existing: ClaudeSettings, pluginNames: ReadonlySet<string>): ClaudeSettings {
    const enabledPlugins: Record<string, boolean> = { ...(existing.enabledPlugins ?? {}) };
    for (const pluginKey of pluginNames) {
      if (pluginKey in enabledPlugins) {
        enabledPlugins[pluginKey] = false;
      }
    }
    return { ...existing, enabledPlugins };
  }

  /** Flips every known plugin key to disabled. Marketplaces are left untouched. */
  disableAll(existing: ClaudeSettings): ClaudeSettings {
    const enabledPlugins: Record<string, boolean> = {};
    for (const pluginKey of Object.keys(existing.enabledPlugins ?? {})) {
      enabledPlugins[pluginKey] = false;
    }
    return { ...existing, enabledPlugins };
  }

  /**
   * Force-sets the given plugin keys to disabled in `existing`, creating the key if it isn't
   * already present — unlike `disable`, which only touches keys that already exist. Used by
   * `enable --only` to explicitly override plugins inherited from a less-specific scope.
   */
  disableForeign(existing: ClaudeSettings, pluginNames: ReadonlySet<string>): ClaudeSettings {
    const enabledPlugins: Record<string, boolean> = { ...(existing.enabledPlugins ?? {}) };
    for (const pluginKey of pluginNames) {
      enabledPlugins[pluginKey] = false;
    }
    return { ...existing, enabledPlugins };
  }
}

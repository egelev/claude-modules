import pc from "picocolors";
import { ClaudeSettings } from "./types.js";
import { ResolvedModules } from "./ModuleResolver.js";
import { Logger } from "../util/Logger.js";
import { deepEqualJson } from "../util/deepEqualJson.js";

/**
 * Computes settings.json mutations for enabling/disabling plugins. Plugin keys are never removed,
 * only flipped between true/false; marketplaces are only ever added, never touched by disabling.
 */
export class SettingsApplier {
  constructor(private readonly logger: Logger) {}

  /**
   * `exclusive: false` (default, what plain `enable` uses) merges: union members are forced to
   * `true`, every other existing key — `true` or `false` — is left exactly as it was. `exclusive:
   * true` (what `enable --only` uses) replaces: every existing key is reset to match membership in
   * the union before union members are forced to `true`. Either way, marketplaces are unaffected by
   * this distinction — they're always purely additive.
   */
  apply(existing: ClaudeSettings, union: ResolvedModules, options?: { exclusive?: boolean }): ClaudeSettings {
    const exclusive = options?.exclusive ?? false;
    const enabledPlugins: Record<string, boolean> = {};
    for (const [pluginKey, enabled] of Object.entries(existing.enabledPlugins ?? {})) {
      enabledPlugins[pluginKey] = exclusive ? union.enabledPluginNames.has(pluginKey) : enabled;
    }
    for (const pluginKey of union.enabledPluginNames) {
      enabledPlugins[pluginKey] = true;
    }

    const extraKnownMarketplaces = { ...(existing.extraKnownMarketplaces ?? {}) };
    for (const [marketplaceName, source] of Object.entries(union.extraKnownMarketplaces)) {
      if (!(marketplaceName in extraKnownMarketplaces)) {
        extraKnownMarketplaces[marketplaceName] = source;
      } else if (!deepEqualJson(extraKnownMarketplaces[marketplaceName], source)) {
        // Declare-time conflicts (moduleUnion.ts) are thrown, because nothing has been written yet
        // and refusing costs nothing. Here the target file already exists and is already in use, so
        // a hard failure would block an otherwise-fine apply over something often harmless (e.g. two
        // equivalent refs written slightly differently) — keep the existing value, but say so.
        this.logger.warn(
          `Marketplace '${pc.bold(marketplaceName)}' is already known in this scope with a different source; ` +
            "keeping the existing value. Remove it first if you want the module's source to take over."
        );
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

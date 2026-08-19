import pc from "picocolors";
import { ScopeResolver } from "./ScopeResolver.js";
import { SettingsRepository } from "./SettingsRepository.js";
import { InstalledPluginsCache } from "./InstalledPluginsCache.js";
import { colorScope } from "./scopeColor.js";
import { ClaudeSettings, Scope } from "./types.js";
import { Logger } from "../util/Logger.js";

interface ScopeSnapshot {
  scope: Scope;
  path: string;
  settings: ClaudeSettings;
}

export interface EnabledPluginsReport {
  /** Effectively-enabled plugin keys (not overridden by a more-specific scope) missing from Claude Code's own cache. */
  uncachedPluginKeys: string[];
  /** Every plugin key active after precedence is applied, across all scopes — what a session would load. */
  effectivelyEnabledPluginKeys: Set<string>;
}

/**
 * Shared by `enable`, `reload`, `disable`, `disable-all`, and `status`: logs every enabled plugin
 * across all scopes in effect at `cwd`, as one consolidated list with each entry tagged with its
 * scope inline (color-coded), so it's clear which plugin comes from where. Each effectively-enabled
 * plugin is cross-checked against Claude Code's own plugin cache and annotated when missing, so a
 * report never reads as a clean success while `PluginCacheInstaller` logged a caching failure
 * moments earlier.
 *
 * The list always covers the *whole* precedence chain (`local > project > user` in a repo, `user`
 * alone outside), not just the audited scope and those below it. Which plugins actually load is
 * decided by the full chain, so truncating it produced two wrong answers: plugins a more-specific
 * scope disabled were still reported as enabled and cache-checked, and the effective set didn't
 * match Claude Code's, which is what `status --verify` compares against. `scope` selects which
 * entries get the `[dry-run]` marker (the *audited* scope, when `dryRun` is true) — not how much of
 * reality to show.
 */
export class EnabledPluginsReporter {
  constructor(
    private readonly scopeResolver: ScopeResolver,
    private readonly settingsRepository: SettingsRepository,
    private readonly installedPluginsCache: InstalledPluginsCache,
    private readonly logger: Logger
  ) {}

  /**
   * Logs one consolidated list of every enabled plugin across all scopes in effect at `cwd`, most
   * specific scope first, each entry tagged inline with its scope, so the user can see where every
   * currently-enabled plugin comes from. A plugin is annotated when a more-specific scope explicitly
   * disables it, since Claude Code resolves `enabledPlugins` with local taking precedence over
   * project over user.
   *
   * `settings` is substituted for the `scope` entries rather than being re-read from disk, because
   * callers pass a computed result that may not be written yet. So under `dryRun` only entries for
   * that one scope are hypothetical (marked `[dry-run]`) while the rest reflect real on-disk state —
   * which is the point: it shows what the other scopes would still override.
   */
  async report(
    scope: Scope,
    settingsPath: string,
    settings: ClaudeSettings,
    cwd: string,
    dryRun: boolean
  ): Promise<EnabledPluginsReport> {
    const cached = await this.installedPluginsCache.keys();
    const uncachedPluginKeys = new Set<string>();
    const effectivelyEnabledPluginKeys = new Set<string>();

    const snapshots: ScopeSnapshot[] = [];
    for (const resolved of await this.scopeResolver.resolveApplicable(cwd)) {
      const isAudited = resolved.scope === scope;
      snapshots.push({
        scope: resolved.scope,
        path: isAudited ? settingsPath : resolved.settingsPath,
        settings: isAudited ? settings : await this.settingsRepository.read(resolved.settingsPath),
      });
    }

    // `resolveApplicable` omits project/local outside a repo, so an audited `user` scope is always
    // present. Guard anyway: a caller auditing a scope that doesn't exist here would otherwise have
    // its computed settings silently dropped from the report.
    if (!snapshots.some((s) => s.scope === scope)) {
      snapshots.unshift({ scope, path: settingsPath, settings });
    }

    const lines: string[] = [];
    for (const [index, snapshot] of snapshots.entries()) {
      lines.push(
        ...this.collectScopeLines(
          snapshot,
          snapshots.slice(0, index),
          snapshot.scope === scope,
          dryRun,
          cached,
          uncachedPluginKeys,
          effectivelyEnabledPluginKeys
        )
      );
    }

    this.logger.section();
    const body = lines.length > 0 ? lines.join("\n") : "  (none)";
    this.logger.info(`Enabled plugin(s):\n${body}`);

    return { uncachedPluginKeys: [...uncachedPluginKeys].sort(), effectivelyEnabledPluginKeys };
  }

  private collectScopeLines(
    snapshot: ScopeSnapshot,
    moreSpecificScopes: readonly ScopeSnapshot[],
    isAudited: boolean,
    dryRun: boolean,
    cached: ReadonlySet<string>,
    uncachedPluginKeys: Set<string>,
    effectivelyEnabledPluginKeys: Set<string>
  ): string[] {
    const names = Object.entries(snapshot.settings.enabledPlugins ?? {})
      .filter(([, enabled]) => enabled)
      .map(([pluginKey]) => pluginKey)
      .sort();

    // Only the audited scope's entries reflect this run's computed result, so only they get marked
    // hypothetical under --dry-run; the rest are on-disk state either way.
    const dryRunMarker = isAudited && dryRun ? ` ${pc.dim("[dry-run]")}` : "";

    return names.map((name) => {
      const overriddenBy = moreSpecificScopes.find((s) => s.settings.enabledPlugins?.[name] === false);
      if (overriddenBy) {
        // Inactive here — a more-specific scope already disables it, so whether it's cached doesn't
        // matter. Left uncolored: color means "actively enabled in that scope", which this isn't.
        return `  - ${pc.bold(name)} (${snapshot.scope} — overridden by ${overriddenBy.scope})${dryRunMarker}`;
      }
      effectivelyEnabledPluginKeys.add(name);
      const scopeTag = colorScope(snapshot.scope);
      if (!cached.has(name)) {
        uncachedPluginKeys.add(name);
        return `  - ${pc.bold(name)} (${scopeTag} — not cached by Claude Code — run 'claude plugin install ${name} --scope user -y')${dryRunMarker}`;
      }
      return `  - ${pc.bold(name)} (${scopeTag})${dryRunMarker}`;
    });
  }
}

import pc from "picocolors";
import { ScopeResolver } from "./ScopeResolver.js";
import { SettingsRepository } from "./SettingsRepository.js";
import { InstalledPluginsCache } from "./InstalledPluginsCache.js";
import { ClaudeSettings, lessSpecificScopes, Scope } from "./types.js";
import { Logger } from "../util/Logger.js";

interface ScopeSnapshot {
  scope: Scope;
  path: string;
  settings: ClaudeSettings;
}

export interface EnabledPluginsReport {
  /** Effectively-enabled plugin keys (not overridden by a more-specific scope) missing from Claude Code's own cache. */
  uncachedPluginKeys: string[];
}

/**
 * Shared by `enable`, `reload`, `disable`, `disable-all`, and `status`: logs which plugins are
 * enabled in a scope — and, for `local`/`project`, a further paragraph per less-specific scope, so
 * it's clear which plugin comes from which scope. Each effectively-enabled plugin is cross-checked
 * against Claude Code's own plugin cache and annotated when missing, so a report never reads as a
 * clean success while `PluginCacheInstaller` logged a caching failure moments earlier.
 */
export class EnabledPluginsReporter {
  constructor(
    private readonly scopeResolver: ScopeResolver,
    private readonly settingsRepository: SettingsRepository,
    private readonly installedPluginsCache: InstalledPluginsCache,
    private readonly logger: Logger
  ) {}

  /**
   * Logs the enabled plugins for the target scope, then — for `local`/`project` — a further
   * paragraph per less-specific scope (`project`/`user`, or just `user`), so the user can see
   * where every currently-enabled plugin actually comes from. A plugin listed as enabled in a
   * less-specific scope is annotated when a more-specific scope explicitly disables it, since
   * Claude Code resolves `enabledPlugins` with local taking precedence over project over user.
   */
  /**
   * `dryRun` only affects the label for `scope` itself (the settings.json this run never wrote,
   * since `settings` is the computed-but-unpersisted result) — less-specific-scope paragraphs
   * always reflect real, already-on-disk state, regardless of `dryRun`.
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

    this.logger.section();
    const current: ScopeSnapshot = { scope, path: settingsPath, settings };
    const moreSpecificScopes: ScopeSnapshot[] = [current];
    this.logScopeParagraph(current, [], false, dryRun, cached, uncachedPluginKeys);

    for (const lessSpecificScope of lessSpecificScopes(scope)) {
      const resolved = await this.scopeResolver.resolve(lessSpecificScope, cwd);
      const lessSpecificSettings = await this.settingsRepository.read(resolved.settingsPath);
      const snapshot: ScopeSnapshot = { scope: lessSpecificScope, path: resolved.settingsPath, settings: lessSpecificSettings };
      this.logger.section();
      this.logScopeParagraph(snapshot, moreSpecificScopes, true, false, cached, uncachedPluginKeys);
      moreSpecificScopes.push(snapshot);
    }

    return { uncachedPluginKeys: [...uncachedPluginKeys].sort() };
  }

  private logScopeParagraph(
    snapshot: ScopeSnapshot,
    moreSpecificScopes: readonly ScopeSnapshot[],
    isUpperScope: boolean,
    dryRun: boolean,
    cached: ReadonlySet<string>,
    uncachedPluginKeys: Set<string>
  ): void {
    const names = Object.entries(snapshot.settings.enabledPlugins ?? {})
      .filter(([, enabled]) => enabled)
      .map(([pluginKey]) => pluginKey)
      .sort();

    const lines = names.map((name) => {
      const overriddenBy = moreSpecificScopes.find((s) => s.settings.enabledPlugins?.[name] === false);
      if (overriddenBy) {
        // Inactive here — a more-specific scope already disables it, so whether it's cached doesn't matter.
        return `  - ${pc.bold(name)} (overridden in ${overriddenBy.scope} scope)`;
      }
      if (!cached.has(name)) {
        uncachedPluginKeys.add(name);
        return `  - ${pc.bold(name)} (not cached by Claude Code — run 'claude plugin install ${name} --scope user -y')`;
      }
      return `  - ${pc.bold(name)}`;
    });

    const label = isUpperScope
      ? `Also enabled in ${snapshot.scope} scope`
      : dryRun
        ? `Would be enabled in ${snapshot.scope} scope`
        : `Enabled plugin(s) in ${snapshot.scope} scope`;
    const body = lines.length > 0 ? lines.join("\n") : "  (none)";
    this.logger.info(`${label} (${pc.bold(snapshot.path)}):\n${body}`);
  }
}

import pc from "picocolors";
import { ResolvedScope, ScopeResolver } from "./ScopeResolver.js";
import { ModuleResolver } from "./ModuleResolver.js";
import { SettingsRepository } from "./SettingsRepository.js";
import { SettingsApplier } from "./SettingsApplier.js";
import { MarketplaceCacheInstaller } from "./MarketplaceCacheInstaller.js";
import { marketplaceSpecFromSource } from "./marketplaceSpec.js";
import { PluginCacheInstaller } from "./PluginCacheInstaller.js";
import { EnabledPluginsReport, EnabledPluginsReporter } from "./EnabledPluginsReporter.js";
import { ClaudeSettings, lessSpecificScopes, MarketplaceSource, Scope } from "./types.js";
import { logSessionReloadHint } from "./sessionReloadHint.js";
import { writeSettingsUnlessDryRun } from "./dryRunWrite.js";
import { ResolvedModules } from "./moduleUnion.js";
import { Logger } from "../util/Logger.js";
import { ScopeRequiredError } from "../util/errors.js";

export interface ApplyModulesResult {
  resolvedScope: ResolvedScope;
  report: EnabledPluginsReport;
  /**
   * This run's own union of plugin keys — distinct from `report.effectivelyEnabledPluginKeys`,
   * which covers the whole scope chain. Callers use this to scope a decision (e.g. whether to
   * fail) to what this run actually touched, rather than to unrelated drift elsewhere in the chain.
   */
  enabledPluginNames: Set<string>;
  /** This run's own declared marketplace names — mirrors enabledPluginNames. */
  marketplaceNames: Set<string>;
  /**
   * Subset of marketplaceNames still unknown to Claude Code whose source could be turned into a
   * 'claude plugin marketplace add' command — i.e. ones --install could plausibly have fixed. A
   * name can be in the printed hint block without being here, if its source isn't convertible;
   * such a marketplace must never fail an --install run, since there's nothing actionable to retry.
   */
  uncachedMarketplaceNames: string[];
}

interface ScopeOverride {
  scope: Scope;
  names: string[];
}

/** Shared by `enable` and `reload`: resolve a set of modules, union them, and write the result into a scope. */
export class ApplyModulesUseCase {
  constructor(
    private readonly scopeResolver: ScopeResolver,
    private readonly moduleResolver: ModuleResolver,
    private readonly settingsRepository: SettingsRepository,
    private readonly settingsApplier: SettingsApplier,
    private readonly marketplaceCacheInstaller: MarketplaceCacheInstaller,
    private readonly pluginCacheInstaller: PluginCacheInstaller,
    private readonly reporter: EnabledPluginsReporter,
    private readonly logger: Logger
  ) {}

  async run(
    moduleNames: readonly string[],
    scope: Scope,
    cwd: string,
    only: boolean,
    install: boolean,
    dryRun: boolean
  ): Promise<ApplyModulesResult> {
    const resolvedScope = await this.scopeResolver.resolve(scope, cwd);
    const union = await this.moduleResolver.resolve(moduleNames);
    const existing = await this.settingsRepository.read(resolvedScope.settingsPath);
    let updated = this.settingsApplier.apply(existing, union, { exclusive: only });

    // --only: any plugin enabled in a less-specific scope that isn't part of the union just
    // applied here would otherwise stay active (Claude Code resolves local > project > user), so
    // explicitly override it to false in this scope's own file. The broader scope's file is only
    // ever read here, never written.
    let overriddenByScope: ScopeOverride[] = [];
    if (only) {
      const overridden = await this.overrideBroaderScopes(scope, cwd, union, updated);
      updated = overridden.updated;
      overriddenByScope = overridden.overriddenByScope;
    }

    await writeSettingsUnlessDryRun(this.settingsRepository, this.logger, dryRun, resolvedScope.settingsPath, updated);

    // Opt-in: by default neither `enable` nor `reload` shells out to `claude` on its own — see the
    // "not cached" report below. Both default install to false and take it via their own --install
    // flag (catches plugins enabled by hand-editing a module or syncing one from another machine,
    // which never went through `plugin install`'s own cache check).
    if (install) {
      this.logger.section();
      // Marketplaces first: KnownMarketplacesCache.get() re-reads the file fresh on every call (no
      // memoization), so a marketplace added here is already visible to PluginCacheInstaller's own
      // "is this marketplace known" check moments later in the same process — giving a plugin from a
      // newly-added marketplace a chance to install in this same run.
      await this.marketplaceCacheInstaller.ensureCached(union.extraKnownMarketplaces, dryRun, resolvedScope.scope);
      await this.pluginCacheInstaller.ensureCached(union.enabledPluginNames, dryRun, resolvedScope.scope);
    }

    this.logger.section();
    const marketplaceCount = Object.keys(union.extraKnownMarketplaces).length;
    const verb = dryRun ? "Would enable" : "Enabled";
    this.logger.info(
      `${verb} module(s) [${pc.bold(moduleNames.join(", "))}] in ${resolvedScope.scope} scope (${pc.bold(resolvedScope.settingsPath)}); ` +
        `${marketplaceCount} marketplace(s) known.`
    );

    if (only) {
      await this.reportOnlyOverrides(scope, resolvedScope, dryRun, overriddenByScope, cwd);
    }

    const report = await this.reporter.report(scope, resolvedScope.settingsPath, updated, cwd, dryRun);

    const convertibleMissingMarketplaceNames = await this.reportMissingMarketplaces(union, install, dryRun);
    this.reportUncachedPlugins(report, install, dryRun);

    if (!dryRun) logSessionReloadHint(this.logger);

    return {
      resolvedScope,
      report,
      enabledPluginNames: union.enabledPluginNames,
      marketplaceNames: new Set(Object.keys(union.extraKnownMarketplaces)),
      uncachedMarketplaceNames: convertibleMissingMarketplaceNames.sort(),
    };
  }

  private async overrideBroaderScopes(
    scope: Scope,
    cwd: string,
    union: ResolvedModules,
    updated: ClaudeSettings
  ): Promise<{ updated: ClaudeSettings; overriddenByScope: ScopeOverride[] }> {
    const overriddenByScope: ScopeOverride[] = [];
    for (const upperScope of lessSpecificScopes(scope)) {
      let resolvedUpper: ResolvedScope;
      try {
        resolvedUpper = await this.scopeResolver.resolve(upperScope, cwd);
      } catch (err) {
        if (!(err instanceof ScopeRequiredError)) throw err;
        // Local scope works fine with no repository (falls back to cwd) — but --only's broader-
        // scope override loop still tries every less-specific scope, and project scope requires
        // one. Skip it rather than crash: there's nothing at that scope to override here anyway.
        this.logger.warn(
          `No git repository found here — there is no ${upperScope}-scope configuration to override with ` +
            "--only (this scope's own changes still apply). To manage your global configuration instead, use --scope user."
        );
        continue;
      }
      const upperSettings = await this.settingsRepository.read(resolvedUpper.settingsPath);
      const foreignNames = new Set(
        Object.entries(upperSettings.enabledPlugins ?? {})
          .filter(([name, enabled]) => enabled && !union.enabledPluginNames.has(name))
          .map(([name]) => name)
      );
      const newlyOverridden = [...foreignNames].filter((name) => updated.enabledPlugins?.[name] !== false).sort();
      if (newlyOverridden.length > 0) {
        overriddenByScope.push({ scope: upperScope, names: newlyOverridden });
      }
      if (foreignNames.size > 0) {
        updated = this.settingsApplier.disableForeign(updated, foreignNames);
      }
    }
    return { updated, overriddenByScope };
  }

  private async reportOnlyOverrides(
    scope: Scope,
    resolvedScope: ResolvedScope,
    dryRun: boolean,
    overriddenByScope: readonly ScopeOverride[],
    cwd: string
  ): Promise<void> {
    this.logger.section();
    if (lessSpecificScopes(scope).length === 0) {
      this.logger.info(
        "--only: 'user' scope has no broader scope to override (it's the least specific) — this scope's own " +
          "plugins were still set to exactly the given module(s)."
      );
    } else if (overriddenByScope.length === 0) {
      this.logger.info(`--only: no plugins from broader scopes needed overriding in ${resolvedScope.scope} scope.`);
    } else {
      const overrideVerb = dryRun ? "would disable" : "disabled";
      const totalCount = overriddenByScope.reduce((sum, { names }) => sum + names.length, 0);
      const taggedNames = overriddenByScope.flatMap(({ scope: originScope, names }) =>
        names.map((name) => `${pc.bold(name)} (${originScope})`)
      );
      this.logger.info(
        `--only: ${overrideVerb} ${totalCount} plugin(s) inherited from broader scopes, by setting them to ` +
          `false in ${resolvedScope.scope} scope (${pc.bold(resolvedScope.settingsPath)}): ${taggedNames.join(", ")}`
      );
    }

    // The report below lists every scope in effect here, including any *more* specific than this
    // one. --only leaves those alone by construction — it can only write this scope's own file,
    // and a more-specific scope outranks whatever it writes — so say so rather than let the
    // report read as though --only overlooked them. Only names scopes that actually exist at
    // `cwd`, so this stays quiet outside a repository.
    const applicable = await this.scopeResolver.resolveApplicable(cwd);
    const moreSpecific = applicable.filter((s) => lessSpecificScopes(s.scope).includes(scope)).map((s) => s.scope);
    if (moreSpecific.length > 0) {
      this.logger.info(
        `--only overrides broader scopes only: ${moreSpecific.join("/")} take precedence over ` +
          `${resolvedScope.scope} here, and can still enable plugins these modules don't name.`
      );
    }
  }

  private async reportMissingMarketplaces(
    union: { extraKnownMarketplaces: Record<string, MarketplaceSource> },
    install: boolean,
    dryRun: boolean
  ): Promise<string[]> {
    const missingMarketplaceNames = await this.marketplaceCacheInstaller.missing(union.extraKnownMarketplaces);
    const convertibleMissingMarketplaceNames: string[] = [];
    if (missingMarketplaceNames.length > 0) {
      this.logger.section();
      const lines = missingMarketplaceNames.map((name) => {
        const spec = marketplaceSpecFromSource(union.extraKnownMarketplaces[name]!);
        if (spec !== undefined) convertibleMissingMarketplaceNames.push(name);
        return spec !== undefined
          ? `  claude plugin marketplace add ${spec} --scope user`
          : `  # '${name}': source isn't a shape this tool can convert to a CLI spec — add it manually`;
      });
      const hint = !install
        ? "Run with --install to attempt these automatically, or add manually with the command(s) above."
        : dryRun
          ? `${pc.dim("[dry-run]")} An add attempt would run now for the marketplace(s) above; nothing was actually run.`
          : "Automatic add did not register the marketplace(s) above — see the warnings above for why, or add manually with the command(s) shown.";
      this.logger.info(`Marketplace(s) not known to Claude Code:\n${lines.join("\n")}\n\n${hint}`);
    }
    return convertibleMissingMarketplaceNames;
  }

  // Header stays neutral regardless of `install`: uncachedPluginKeys covers the whole scope
  // chain, not just this run's union, so claiming "these were just attempted" would be false for
  // any entry that came from unrelated drift elsewhere in the chain. This path is shared by
  // `enable` and `reload`, both of which now have their own --install flag to point the user at.
  private reportUncachedPlugins(report: EnabledPluginsReport, install: boolean, dryRun: boolean): void {
    if (report.uncachedPluginKeys.length > 0) {
      this.logger.section();
      const commands = report.uncachedPluginKeys.map((key) => `  claude plugin install ${key} --scope user -y`).join("\n");
      const hint = !install
        ? "Run with --install to attempt these automatically, or install manually with the command(s) above."
        : dryRun
          ? `${pc.dim("[dry-run]")} An install attempt would run now for the plugin(s) above; nothing was actually run.`
          : "Automatic install did not cache the plugin(s) above — see the warnings above for why, or install manually with the command(s) shown.";
      this.logger.info(`Plugin(s) not cached by Claude Code:\n${commands}\n\n${hint}`);
    }
  }
}

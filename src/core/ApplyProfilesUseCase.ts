import pc from "picocolors";
import { ResolvedScope, ScopeResolver } from "./ScopeResolver.js";
import { ProfileResolver } from "./ProfileResolver.js";
import { SettingsRepository } from "./SettingsRepository.js";
import { SettingsApplier } from "./SettingsApplier.js";
import { PluginCacheInstaller } from "./PluginCacheInstaller.js";
import { EnabledPluginsReporter } from "./EnabledPluginsReporter.js";
import { lessSpecificScopes, Scope } from "./types.js";
import { Logger } from "../util/Logger.js";

/** Shared by `enable` and `reload`: resolve a set of profiles, union them, and write the result into a scope. */
export class ApplyProfilesUseCase {
  constructor(
    private readonly scopeResolver: ScopeResolver,
    private readonly profileResolver: ProfileResolver,
    private readonly settingsRepository: SettingsRepository,
    private readonly settingsApplier: SettingsApplier,
    private readonly pluginCacheInstaller: PluginCacheInstaller,
    private readonly reporter: EnabledPluginsReporter,
    private readonly logger: Logger
  ) {}

  async run(
    profileNames: readonly string[],
    scope: Scope,
    cwd: string,
    only: boolean,
    dryRun: boolean
  ): Promise<ResolvedScope> {
    const resolvedScope = await this.scopeResolver.resolve(scope, cwd);
    const union = await this.profileResolver.resolve(profileNames);
    const existing = await this.settingsRepository.read(resolvedScope.settingsPath);
    let updated = this.settingsApplier.apply(existing, union);

    // --only: any plugin enabled in a less-specific scope that isn't part of the union just
    // applied here would otherwise stay active (Claude Code resolves local > project > user), so
    // explicitly override it to false in this scope's own file. The broader scope's file is only
    // ever read here, never written.
    const overriddenByScope: { scope: Scope; names: string[] }[] = [];
    if (only) {
      for (const upperScope of lessSpecificScopes(scope)) {
        const resolvedUpper = await this.scopeResolver.resolve(upperScope, cwd);
        const upperSettings = await this.settingsRepository.read(resolvedUpper.settingsPath);
        const foreignNames = new Set(
          Object.entries(upperSettings.enabledPlugins ?? {})
            .filter(([name, enabled]) => enabled && !union.enabledPluginNames.has(name))
            .map(([name]) => name)
        );
        const newlyOverridden = [...foreignNames]
          .filter((name) => updated.enabledPlugins?.[name] !== false)
          .sort();
        if (newlyOverridden.length > 0) {
          overriddenByScope.push({ scope: upperScope, names: newlyOverridden });
        }
        if (foreignNames.size > 0) {
          updated = this.settingsApplier.disableForeign(updated, foreignNames);
        }
      }
    }

    if (dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would write ${pc.bold(resolvedScope.settingsPath)} — no files modified.`);
    } else {
      await this.settingsRepository.write(resolvedScope.settingsPath, updated);
    }

    // Best-effort: catches plugins enabled by hand-editing a profile or syncing one from another
    // machine, which never went through `install`'s own cache check.
    this.logger.section();
    await this.pluginCacheInstaller.ensureCached(union.enabledPluginNames, dryRun);

    this.logger.section();
    const marketplaceCount = Object.keys(union.extraKnownMarketplaces).length;
    const verb = dryRun ? "Would enable" : "Enabled";
    this.logger.info(
      `${verb} profile(s) [${pc.bold(profileNames.join(", "))}] in ${resolvedScope.scope} scope (${pc.bold(resolvedScope.settingsPath)}); ` +
        `${marketplaceCount} marketplace(s) known.`
    );

    if (only) {
      this.logger.section();
      if (lessSpecificScopes(scope).length === 0) {
        this.logger.warn(
          "--only has no effect in 'user' scope: it is the least specific scope, so there is nothing broader to override."
        );
      } else if (overriddenByScope.length === 0) {
        this.logger.info(`--only: no plugins from broader scopes needed overriding in ${resolvedScope.scope} scope.`);
      } else {
        const overrideVerb = dryRun ? "would disable" : "disabled";
        for (const { scope: originScope, names } of overriddenByScope) {
          this.logger.info(
            `--only: ${overrideVerb} ${names.length} plugin(s) inherited from ${originScope} scope, by setting them to ` +
              `false in ${resolvedScope.scope} scope (${pc.bold(resolvedScope.settingsPath)}): ${pc.bold(names.join(", "))}`
          );
        }
      }
    }

    await this.reporter.report(scope, resolvedScope.settingsPath, updated, cwd, dryRun);

    return resolvedScope;
  }
}

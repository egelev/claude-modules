import pc from "picocolors";
import { ScopeResolver } from "./ScopeResolver.js";
import { ProfileResolver } from "./ProfileResolver.js";
import { SettingsRepository } from "./SettingsRepository.js";
import { SettingsApplier } from "./SettingsApplier.js";
import { EnabledPluginsReporter } from "./EnabledPluginsReporter.js";
import { Scope } from "./types.js";
import { Logger } from "../util/Logger.js";

/** Shared by `disable` and `disable-all`: resolve a scope's settings.json and flip plugins off. */
export class DisableProfilesUseCase {
  constructor(
    private readonly scopeResolver: ScopeResolver,
    private readonly profileResolver: ProfileResolver,
    private readonly settingsRepository: SettingsRepository,
    private readonly settingsApplier: SettingsApplier,
    private readonly reporter: EnabledPluginsReporter,
    private readonly logger: Logger
  ) {}

  /** Disables the union of plugins enabled across the given profiles. */
  async run(profileNames: readonly string[], scope: Scope, cwd: string, dryRun: boolean): Promise<void> {
    const resolvedScope = await this.scopeResolver.resolve(scope, cwd);
    const pluginNames = await this.profileResolver.resolveEnabledPluginNames(profileNames);
    const existing = await this.settingsRepository.read(resolvedScope.settingsPath);
    const updated = this.settingsApplier.disable(existing, pluginNames);
    if (dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would write ${pc.bold(resolvedScope.settingsPath)} — no files modified.`);
    } else {
      await this.settingsRepository.write(resolvedScope.settingsPath, updated);
    }

    const verb = dryRun ? "Would disable" : "Disabled";
    this.logger.info(
      `${verb} profile(s) [${pc.bold(profileNames.join(", "))}] in ${resolvedScope.scope} scope (${pc.bold(resolvedScope.settingsPath)}).`
    );

    await this.reporter.report(scope, resolvedScope.settingsPath, updated, cwd, dryRun);
  }

  /** Disables every currently-known plugin in the scope. */
  async runAll(scope: Scope, cwd: string, dryRun: boolean): Promise<void> {
    const resolvedScope = await this.scopeResolver.resolve(scope, cwd);
    const existing = await this.settingsRepository.read(resolvedScope.settingsPath);
    const updated = this.settingsApplier.disableAll(existing);
    if (dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would write ${pc.bold(resolvedScope.settingsPath)} — no files modified.`);
    } else {
      await this.settingsRepository.write(resolvedScope.settingsPath, updated);
    }

    const verb = dryRun ? "Would disable" : "Disabled";
    this.logger.info(`${verb} all plugins in ${resolvedScope.scope} scope (${pc.bold(resolvedScope.settingsPath)}).`);

    await this.reporter.report(scope, resolvedScope.settingsPath, updated, cwd, dryRun);
  }
}

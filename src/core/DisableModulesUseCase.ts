import pc from "picocolors";
import { ScopeResolver } from "./ScopeResolver.js";
import { ModuleResolver } from "./ModuleResolver.js";
import { SettingsRepository } from "./SettingsRepository.js";
import { SettingsApplier } from "./SettingsApplier.js";
import { EnabledPluginsReporter } from "./EnabledPluginsReporter.js";
import { Scope } from "./types.js";
import { logSessionReloadHint } from "./sessionReloadHint.js";
import { Logger } from "../util/Logger.js";

/** Shared by `disable` and `disable-all`: resolve a scope's settings.json and flip plugins off. */
export class DisableModulesUseCase {
  constructor(
    private readonly scopeResolver: ScopeResolver,
    private readonly moduleResolver: ModuleResolver,
    private readonly settingsRepository: SettingsRepository,
    private readonly settingsApplier: SettingsApplier,
    private readonly reporter: EnabledPluginsReporter,
    private readonly logger: Logger
  ) {}

  /** Disables the union of plugins enabled across the given modules. */
  async run(moduleNames: readonly string[], scope: Scope, cwd: string, dryRun: boolean): Promise<void> {
    const resolvedScope = await this.scopeResolver.resolve(scope, cwd);
    const pluginNames = await this.moduleResolver.resolveEnabledPluginNames(moduleNames);
    const existing = await this.settingsRepository.read(resolvedScope.settingsPath);
    const updated = this.settingsApplier.disable(existing, pluginNames);
    if (dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would write ${pc.bold(resolvedScope.settingsPath)} — no files modified.`);
    } else {
      await this.settingsRepository.write(resolvedScope.settingsPath, updated);
    }

    const verb = dryRun ? "Would disable" : "Disabled";
    this.logger.info(
      `${verb} module(s) [${pc.bold(moduleNames.join(", "))}] in ${resolvedScope.scope} scope (${pc.bold(resolvedScope.settingsPath)}).`
    );

    await this.reporter.report(scope, resolvedScope.settingsPath, updated, cwd, dryRun);
    if (!dryRun) logSessionReloadHint(this.logger);
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
    if (!dryRun) logSessionReloadHint(this.logger);
  }
}

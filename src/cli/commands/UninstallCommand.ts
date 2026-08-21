import pc from "picocolors";
import { Command } from "./Command.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { parsePluginKey } from "../../core/pluginKey.js";
import { bumpMinor } from "../../core/semver.js";
import { Logger } from "../../util/Logger.js";

export class UninstallCommand implements Command {
  constructor(
    private readonly pluginKey: string,
    private readonly moduleName: string,
    /** Set the key to `false` instead of deleting it — an explicit override a composed parent can
     * use to beat a composed child's `true` (see CompositionResolver). Deleting means "this module
     * says nothing about the plugin"; `false` means "this module explicitly turns it off". */
    private readonly disable: boolean,
    private readonly moduleStore: ModuleStore,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const { full } = parsePluginKey(this.pluginKey);
    const module = await this.moduleStore.load(this.moduleName);

    // --disable's whole point is recording an override for a plugin this module doesn't declare
    // itself — typically one it only inherits via composition — so, unlike plain uninstall, it must
    // not bail out just because the module's own (pre-composition) enabledPlugins doesn't have it.
    // The only true no-op is when it's already explicitly false.
    if (this.disable) {
      if (module.enabledPlugins[full] === false) {
        this.logger.warn(
          `'${pc.bold(full)}' is already explicitly disabled in module '${pc.bold(this.moduleName)}'; nothing to do.`
        );
        return;
      }
      if (this.dryRun) {
        this.logger.info(`${pc.dim("[dry-run]")} Would disable '${pc.bold(full)}' in module '${pc.bold(this.moduleName)}'.`);
        return;
      }
      module.enabledPlugins[full] = false;
      await this.moduleStore.saveWithBump(this.moduleName, module, bumpMinor);
      this.logger.info(`Disabled '${pc.bold(full)}' in module '${pc.bold(this.moduleName)}'.`);
      return;
    }

    if (!module.enabledPlugins[full]) {
      this.logger.warn(`'${pc.bold(full)}' is not enabled in module '${pc.bold(this.moduleName)}'; nothing to do.`);
      return;
    }

    if (this.dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would uninstall '${pc.bold(full)}' from module '${pc.bold(this.moduleName)}'.`);
      return;
    }

    delete module.enabledPlugins[full];
    await this.moduleStore.saveWithBump(this.moduleName, module, bumpMinor);
    this.logger.info(`Uninstalled '${pc.bold(full)}' from module '${pc.bold(this.moduleName)}'.`);
  }
}

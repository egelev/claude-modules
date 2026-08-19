import pc from "picocolors";
import { Command } from "./Command.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { parsePluginKey } from "../../core/pluginKey.js";
import { Logger } from "../../util/Logger.js";

export class UninstallCommand implements Command {
  constructor(
    private readonly pluginKey: string,
    private readonly moduleName: string,
    private readonly moduleStore: ModuleStore,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const { full } = parsePluginKey(this.pluginKey);
    const module = await this.moduleStore.load(this.moduleName);

    if (!module.enabledPlugins[full]) {
      this.logger.warn(`'${pc.bold(full)}' is not enabled in module '${pc.bold(this.moduleName)}'; nothing to do.`);
      return;
    }

    if (this.dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would uninstall '${pc.bold(full)}' from module '${pc.bold(this.moduleName)}'.`);
      return;
    }

    delete module.enabledPlugins[full];
    await this.moduleStore.save(this.moduleName, module);
    this.logger.info(`Uninstalled '${pc.bold(full)}' from module '${pc.bold(this.moduleName)}'.`);
  }
}

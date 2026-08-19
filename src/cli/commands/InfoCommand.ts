import pc from "picocolors";
import { Command } from "./Command.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { Logger } from "../../util/Logger.js";

export class InfoCommand implements Command {
  constructor(
    private readonly name: string,
    private readonly moduleStore: ModuleStore,
    private readonly logger: Logger
  ) {}

  async execute(): Promise<void> {
    const module = await this.moduleStore.load(this.name);

    if (module.composedModules.length > 0) {
      this.logger.info(`${pc.bold(this.name)}: composes ${module.composedModules.length} module(s):`);
      for (const composed of module.composedModules) {
        this.logger.info(`  ${pc.bold(composed)}`);
      }
      this.logger.section();
    }

    const pluginEntries = Object.entries(module.enabledPlugins);
    if (pluginEntries.length === 0) {
      this.logger.info(`${pc.bold(this.name)}: no plugins enabled.`);
    } else {
      this.logger.info(`${pc.bold(this.name)}: ${pluginEntries.length} plugin(s):`);
      for (const [key, enabled] of pluginEntries) {
        this.logger.info(`  ${pc.bold(key)} (${enabled ? "enabled" : "disabled"})`);
      }
    }

    this.logger.section();
    const marketplaceEntries = Object.entries(module.extraKnownMarketplaces);
    if (marketplaceEntries.length === 0) {
      this.logger.info(`${pc.bold(this.name)}: no additional marketplaces known.`);
    } else {
      this.logger.info(`${pc.bold(this.name)}: ${marketplaceEntries.length} marketplace(s):`);
      for (const [name, source] of marketplaceEntries) {
        this.logger.info(`  ${pc.bold(name)}: ${JSON.stringify(source)}`);
      }
    }
  }
}

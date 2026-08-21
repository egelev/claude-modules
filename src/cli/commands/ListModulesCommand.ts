import pc from "picocolors";
import { Command } from "./Command.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { Logger } from "../../util/Logger.js";

export class ListModulesCommand implements Command {
  constructor(
    private readonly moduleStore: ModuleStore,
    private readonly logger: Logger
  ) {}

  async execute(): Promise<void> {
    const names = await this.moduleStore.list();
    if (names.length === 0) {
      this.logger.info("No modules found. Create one with 'claude-modules create <name>'.");
      return;
    }

    for (const name of names) {
      const module = await this.moduleStore.load(name);
      const enabledCount = Object.values(module.enabledPlugins).filter(Boolean).length;
      const marketplaceCount = Object.keys(module.extraKnownMarketplaces).length;
      this.logger.info(
        `${pc.bold(name)} (v${module.version}) — ${enabledCount} plugin(s) enabled, ${marketplaceCount} marketplace(s)`
      );
    }
  }
}

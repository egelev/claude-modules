import pc from "picocolors";
import { Command } from "./Command.js";
import { MarketplaceRegistry } from "../../core/MarketplaceRegistry.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { Logger } from "../../util/Logger.js";

export class ListMarketplacesCommand implements Command {
  constructor(
    private readonly moduleName: string | undefined,
    private readonly marketplaceRegistry: MarketplaceRegistry,
    private readonly moduleStore: ModuleStore,
    private readonly logger: Logger
  ) {}

  async execute(): Promise<void> {
    if (this.moduleName !== undefined) {
      const module = await this.moduleStore.load(this.moduleName);
      const entries = Object.entries(module.extraKnownMarketplaces);
      if (entries.length === 0) {
        this.logger.info(`No marketplaces known to module '${pc.bold(this.moduleName)}'.`);
        return;
      }
      for (const [name, source] of entries) {
        this.logger.info(`${pc.bold(name)}: ${JSON.stringify(source)}`);
      }
      return;
    }

    const marketplaces = await this.marketplaceRegistry.list();
    const entries = Object.entries(marketplaces);
    if (entries.length === 0) {
      this.logger.info("No marketplaces registered. Register one with 'claude-modules marketplace add <spec>'.");
      return;
    }
    for (const [name, source] of entries) {
      this.logger.info(`${pc.bold(name)}: ${JSON.stringify(source)}`);
    }
  }
}

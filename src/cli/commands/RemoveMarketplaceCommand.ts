import { Command } from "./Command.js";
import { MarketplaceRegistry } from "../../core/MarketplaceRegistry.js";
import { Logger } from "../../util/Logger.js";

export class RemoveMarketplaceCommand implements Command {
  constructor(
    private readonly name: string,
    private readonly marketplaceRegistry: MarketplaceRegistry,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    if ((await this.marketplaceRegistry.get(this.name)) === undefined) {
      this.logger.warn(`Marketplace '${this.name}' is not registered; nothing to remove.`);
      return;
    }

    if (this.dryRun) {
      this.logger.info(`[dry-run] Would remove marketplace '${this.name}' from the global registry.`);
      return;
    }

    await this.marketplaceRegistry.remove(this.name);
    this.logger.info(`Removed marketplace '${this.name}' from the global registry.`);
  }
}

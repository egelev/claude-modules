import pc from "picocolors";
import { Command } from "./Command.js";
import { MarketplaceRegistry } from "../../core/MarketplaceRegistry.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { bumpMinor } from "../../core/semver.js";
import { Logger } from "../../util/Logger.js";
import { describeMarketplaceTarget } from "./marketplaceTarget.js";

export class RemoveMarketplaceCommand implements Command {
  constructor(
    private readonly name: string,
    private readonly moduleName: string | undefined,
    private readonly marketplaceRegistry: MarketplaceRegistry,
    private readonly moduleStore: ModuleStore,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const target = describeMarketplaceTarget(this.moduleName);

    if (this.moduleName === undefined) {
      if ((await this.marketplaceRegistry.get(this.name)) === undefined) {
        this.logger.warn(`Marketplace '${pc.bold(this.name)}' is not registered; nothing to remove.`);
        return;
      }
      if (this.dryRun) {
        this.logger.info(`${pc.dim("[dry-run]")} Would remove marketplace '${pc.bold(this.name)}' from ${target}.`);
        return;
      }
      await this.marketplaceRegistry.remove(this.name);
      this.logger.info(`Removed marketplace '${pc.bold(this.name)}' from ${target}.`);
      return;
    }

    const module = await this.moduleStore.load(this.moduleName);
    if (!(this.name in module.extraKnownMarketplaces)) {
      this.logger.warn(`Marketplace '${pc.bold(this.name)}' is not registered on module '${pc.bold(this.moduleName)}'; nothing to remove.`);
      return;
    }

    if (this.dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would remove marketplace '${pc.bold(this.name)}' from ${target}.`);
      return;
    }

    delete module.extraKnownMarketplaces[this.name];
    await this.moduleStore.saveWithBump(this.moduleName, module, bumpMinor);
    this.logger.info(`Removed marketplace '${pc.bold(this.name)}' from ${target}.`);
  }
}

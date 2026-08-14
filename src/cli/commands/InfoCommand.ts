import { Command } from "./Command.js";
import { ProfileStore } from "../../core/ProfileStore.js";
import { Logger } from "../../util/Logger.js";

export class InfoCommand implements Command {
  constructor(
    private readonly name: string,
    private readonly profileStore: ProfileStore,
    private readonly logger: Logger
  ) {}

  async execute(): Promise<void> {
    const profile = await this.profileStore.load(this.name);

    const pluginEntries = Object.entries(profile.enabledPlugins);
    if (pluginEntries.length === 0) {
      this.logger.info(`${this.name}: no plugins enabled.`);
    } else {
      this.logger.info(`${this.name}: ${pluginEntries.length} plugin(s):`);
      for (const [key, enabled] of pluginEntries) {
        this.logger.info(`  ${key} (${enabled ? "enabled" : "disabled"})`);
      }
    }

    const marketplaceEntries = Object.entries(profile.extraKnownMarketplaces);
    if (marketplaceEntries.length === 0) {
      this.logger.info(`${this.name}: no additional marketplaces known.`);
    } else {
      this.logger.info(`${this.name}: ${marketplaceEntries.length} marketplace(s):`);
      for (const [name, source] of marketplaceEntries) {
        this.logger.info(`  ${name}: ${JSON.stringify(source)}`);
      }
    }
  }
}

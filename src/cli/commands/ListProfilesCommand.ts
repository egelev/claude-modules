import { Command } from "./Command.js";
import { ProfileStore } from "../../core/ProfileStore.js";
import { Logger } from "../../util/Logger.js";

export class ListProfilesCommand implements Command {
  constructor(
    private readonly profileStore: ProfileStore,
    private readonly logger: Logger
  ) {}

  async execute(): Promise<void> {
    const names = await this.profileStore.list();
    if (names.length === 0) {
      this.logger.info("No profiles found. Create one with 'claude-profiles create <name>'.");
      return;
    }

    for (const name of names) {
      const profile = await this.profileStore.load(name);
      const enabledCount = Object.values(profile.enabledPlugins).filter(Boolean).length;
      const marketplaceCount = Object.keys(profile.extraKnownMarketplaces).length;
      this.logger.info(`${name} — ${enabledCount} plugin(s) enabled, ${marketplaceCount} marketplace(s)`);
    }
  }
}

import pc from "picocolors";
import { Command } from "./Command.js";
import { ProfileStore } from "../../core/ProfileStore.js";
import { parsePluginKey } from "../../core/pluginKey.js";
import { Logger } from "../../util/Logger.js";

export class UninstallCommand implements Command {
  constructor(
    private readonly pluginKey: string,
    private readonly profileName: string,
    private readonly profileStore: ProfileStore,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const { full } = parsePluginKey(this.pluginKey);
    const profile = await this.profileStore.load(this.profileName);

    if (!profile.enabledPlugins[full]) {
      this.logger.warn(`'${pc.bold(full)}' is not enabled in profile '${pc.bold(this.profileName)}'; nothing to do.`);
      return;
    }

    if (this.dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would uninstall '${pc.bold(full)}' from profile '${pc.bold(this.profileName)}'.`);
      return;
    }

    delete profile.enabledPlugins[full];
    await this.profileStore.save(this.profileName, profile);
    this.logger.info(`Uninstalled '${pc.bold(full)}' from profile '${pc.bold(this.profileName)}'.`);
  }
}

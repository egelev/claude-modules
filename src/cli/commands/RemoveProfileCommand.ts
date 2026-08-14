import pc from "picocolors";
import { Command } from "./Command.js";
import { ProfileStore } from "../../core/ProfileStore.js";
import { Logger } from "../../util/Logger.js";

export class RemoveProfileCommand implements Command {
  constructor(
    private readonly name: string,
    private readonly profileStore: ProfileStore,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    if (!(await this.profileStore.exists(this.name))) {
      this.logger.warn(`Profile '${pc.bold(this.name)}' does not exist; nothing to remove.`);
      return;
    }

    if (this.dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would remove profile '${pc.bold(this.name)}'.`);
      return;
    }

    await this.profileStore.remove(this.name);
    this.logger.info(`Removed profile '${pc.bold(this.name)}'.`);
  }
}

import pc from "picocolors";
import { Command } from "./Command.js";
import { ProfileStore } from "../../core/ProfileStore.js";
import { Logger } from "../../util/Logger.js";
import { ProfileExistsError } from "../../util/errors.js";

export class CreateProfileCommand implements Command {
  constructor(
    private readonly name: string,
    private readonly profileStore: ProfileStore,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    if (this.dryRun) {
      if (await this.profileStore.exists(this.name)) {
        throw new ProfileExistsError(this.name);
      }
      this.logger.info(`${pc.dim("[dry-run]")} Would create profile '${pc.bold(this.name)}'.`);
      return;
    }

    await this.profileStore.create(this.name);
    this.logger.info(`Created profile '${pc.bold(this.name)}'.`);
  }
}

import pc from "picocolors";
import { Command } from "./Command.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { Logger } from "../../util/Logger.js";

export class RemoveModuleCommand implements Command {
  constructor(
    private readonly name: string,
    private readonly moduleStore: ModuleStore,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    if (!(await this.moduleStore.exists(this.name))) {
      this.logger.warn(`Module '${pc.bold(this.name)}' does not exist; nothing to remove.`);
      return;
    }

    if (this.dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would remove module '${pc.bold(this.name)}'.`);
      return;
    }

    await this.moduleStore.remove(this.name);
    this.logger.info(`Removed module '${pc.bold(this.name)}'.`);
  }
}

import pc from "picocolors";
import { Command } from "./Command.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { bumpMinor } from "../../core/semver.js";
import { Logger } from "../../util/Logger.js";

export class ComposeRemoveCommand implements Command {
  constructor(
    private readonly moduleName: string,
    private readonly composedNames: readonly string[],
    private readonly moduleStore: ModuleStore,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const module = await this.moduleStore.load(this.moduleName);

    const requested = [...new Set(this.composedNames)];
    const toRemove = requested.filter((name) => module.composedModules.includes(name));
    const notComposed = requested.filter((name) => !module.composedModules.includes(name));

    if (toRemove.length === 0) {
      this.logger.warn(
        `'${pc.bold(this.moduleName)}' does not compose any of [${requested.map((n) => pc.bold(n)).join(", ")}]; nothing to remove.`
      );
      return;
    }

    const skippedNote = notComposed.length > 0 ? ` (not composed, skipped: ${notComposed.join(", ")})` : "";

    if (this.dryRun) {
      this.logger.info(
        `${pc.dim("[dry-run]")} Would remove [${toRemove.map((n) => pc.bold(n)).join(", ")}] from '${pc.bold(this.moduleName)}''s composed modules${skippedNote}.`
      );
      return;
    }

    module.composedModules = module.composedModules.filter((name) => !toRemove.includes(name));
    await this.moduleStore.saveWithBump(this.moduleName, module, bumpMinor);
    this.logger.info(
      `Removed [${toRemove.map((n) => pc.bold(n)).join(", ")}] from '${pc.bold(this.moduleName)}''s composed modules${skippedNote}.`
    );
  }
}

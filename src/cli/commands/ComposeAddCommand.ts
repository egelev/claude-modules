import pc from "picocolors";
import { Command } from "./Command.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { CompositionResolver } from "../../core/CompositionResolver.js";
import { bumpPatch } from "../../core/semver.js";
import { Logger } from "../../util/Logger.js";

export class ComposeAddCommand implements Command {
  constructor(
    private readonly moduleName: string,
    private readonly composedNames: readonly string[],
    private readonly moduleStore: ModuleStore,
    private readonly compositionResolver: CompositionResolver,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const module = await this.moduleStore.load(this.moduleName);

    const requested = [...new Set(this.composedNames)];
    const alreadyComposed = requested.filter((name) => module.composedModules.includes(name));
    const toAdd = requested.filter((name) => !module.composedModules.includes(name));

    if (toAdd.length === 0) {
      this.logger.warn(
        `'${pc.bold(this.moduleName)}' already composes [${requested.map((n) => pc.bold(n)).join(", ")}]; nothing to add.`
      );
      return;
    }

    module.composedModules = [...module.composedModules, ...toAdd];
    // Validates cycles, missing references, and sibling marketplace conflicts before anything is
    // written — same override-map trick 'create --compose' uses, so this rejects the whole batch
    // atomically rather than partially applying it.
    await this.compositionResolver.resolveEffective(this.moduleName, new Map([[this.moduleName, module]]));

    const skippedNote = alreadyComposed.length > 0 ? ` (already composed, skipped: ${alreadyComposed.join(", ")})` : "";

    if (this.dryRun) {
      this.logger.info(
        `${pc.dim("[dry-run]")} Would add [${toAdd.map((n) => pc.bold(n)).join(", ")}] to '${pc.bold(this.moduleName)}''s composed modules${skippedNote}.`
      );
      return;
    }

    await this.moduleStore.saveWithBump(this.moduleName, module, bumpPatch);
    this.logger.info(
      `Added [${toAdd.map((n) => pc.bold(n)).join(", ")}] to '${pc.bold(this.moduleName)}''s composed modules${skippedNote}.`
    );
  }
}

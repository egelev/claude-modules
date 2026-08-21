import pc from "picocolors";
import { Command } from "./Command.js";
import { DisableModulesUseCase } from "../../core/DisableModulesUseCase.js";
import { ModuleListFile } from "../../core/ModuleListFile.js";
import { Scope } from "../../core/types.js";
import { Logger } from "../../util/Logger.js";

export class DisableCommand implements Command {
  constructor(
    private readonly moduleNames: readonly string[],
    private readonly scope: Scope,
    private readonly save: boolean,
    private readonly cwd: string,
    private readonly disableModulesUseCase: DisableModulesUseCase,
    private readonly moduleListFile: ModuleListFile,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    await this.disableModulesUseCase.run(this.moduleNames, this.scope, this.cwd, this.dryRun);

    this.logger.section();
    const existingListPath = await this.moduleListFile.find(this.scope, this.cwd);
    const existingNames = existingListPath ? await this.moduleListFile.read(existingListPath) : [];
    const toRemove = new Set(this.moduleNames);
    const resultingNames = existingNames.filter((name) => !toRemove.has(name));
    const notInList = this.moduleNames.filter((name) => !existingNames.includes(name));
    const skippedNote = notInList.length > 0 ? ` (not in list, skipped: ${notInList.join(", ")})` : "";

    if (this.save) {
      if (!existingListPath) {
        this.logger.warn(`No saved module list for ${this.scope} scope; nothing to remove.`);
      } else if (resultingNames.length === existingNames.length) {
        this.logger.warn(
          `None of [${pc.bold(this.moduleNames.join(", "))}] were in ${pc.bold(existingListPath)}; nothing to remove.`
        );
      } else if (this.dryRun) {
        this.logger.info(
          `${pc.dim("[dry-run]")} Would update ${pc.bold(existingListPath)} to [${pc.bold(resultingNames.join(", "))}]${skippedNote}.`
        );
      } else {
        await this.moduleListFile.write(existingListPath, resultingNames);
        this.logger.info(`Updated ${pc.bold(existingListPath)}: [${pc.bold(resultingNames.join(", "))}]${skippedNote}.`);
      }
    }

    const note = existingListPath ? "" : " (no saved list for this scope)";
    // resultingNames/the "active" line above is always the real (or hypothetical, without --save)
    // post-disable set — never changed here. Plain `disable` (no --save) only ever disables live;
    // it never touches a saved list file, so when one exists, the line above can read as "gone" while
    // the file that `reload` reads from still lists it. Say so explicitly rather than let that surface
    // later as a silent 're-enable' on the next reload.
    const unsavedNote =
      !this.save && existingListPath
        ? ` (not saved — run with --save to persist; ${pc.bold(existingListPath)} still says [${pc.bold(existingNames.join(", "))}])`
        : "";
    this.logger.info(
      `Modules active in ${this.scope} scope: [${pc.bold(resultingNames.join(", "))}]${note}${unsavedNote}.`
    );
  }
}

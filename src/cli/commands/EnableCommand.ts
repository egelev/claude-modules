import pc from "picocolors";
import { Command } from "./Command.js";
import { ApplyModulesUseCase } from "../../core/ApplyModulesUseCase.js";
import { ModuleListFile } from "../../core/ModuleListFile.js";
import { assertInstallCached } from "../../core/installCheck.js";
import { Scope } from "../../core/types.js";
import { describeError } from "../../util/errors.js";
import { Logger } from "../../util/Logger.js";

export class EnableCommand implements Command {
  constructor(
    private readonly moduleNames: readonly string[],
    private readonly scope: Scope,
    private readonly only: boolean,
    private readonly install: boolean,
    private readonly save: boolean,
    private readonly savePath: string | undefined,
    private readonly cwd: string,
    private readonly applyModulesUseCase: ApplyModulesUseCase,
    private readonly moduleListFile: ModuleListFile,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const { report, enabledPluginNames, marketplaceNames, uncachedMarketplaceNames } =
      await this.applyModulesUseCase.run(
        this.moduleNames,
        this.scope,
        this.cwd,
        this.only,
        this.install,
        this.dryRun
      );

    this.logger.section();
    // The merge base always comes from the scope's canonical saved list (if any), regardless of
    // whether this call's own --save target is that same file or an explicit --save=<path> — so
    // "what's active" reflects the scope's real history even when saving somewhere else this time.
    const existingListPath = await this.moduleListFile.find(this.scope, this.cwd);
    // The settings write above already succeeded — a malformed saved list here must degrade to a
    // warning, not an uncaught throw that would make a successful 'enable' look like it failed.
    let existingNames: string[] = [];
    if (existingListPath) {
      try {
        existingNames = await this.moduleListFile.read(existingListPath);
      } catch (err) {
        this.logger.warn(`Could not read ${pc.bold(existingListPath)}: ${describeError(err)}`);
      }
    }
    // --only means "exactly these modules"; plain enable accumulates onto whatever was active.
    const resultingNames = this.only
      ? [...new Set(this.moduleNames)].sort()
      : [...new Set([...existingNames, ...this.moduleNames])].sort();

    if (this.save) {
      // Bare --save goes to the canonical location for the scope just applied, so `reload
      // --scope <same>` reads back exactly what was written. An explicit --save=<path> still
      // resolves against cwd — a typed relative path should mean "relative to me".
      const targetPath =
        this.savePath !== undefined
          ? this.moduleListFile.resolveExplicitPath(this.cwd, this.savePath)
          : await this.moduleListFile.pathFor(this.scope, this.cwd);

      if (this.dryRun) {
        this.logger.info(
          `${pc.dim("[dry-run]")} Would save module selection [${pc.bold(resultingNames.join(", "))}] to ${pc.bold(targetPath)}.`
        );
      } else {
        await this.moduleListFile.write(targetPath, resultingNames);
        this.logger.info(`Saved module selection to ${pc.bold(targetPath)}.`);
      }
    }

    const persisted = existingListPath !== null || this.save;
    const note = persisted ? "" : " (not saved — pass --save to persist this list)";
    this.logger.info(`Modules active in ${this.scope} scope: [${pc.bold(resultingNames.join(", "))}]${note}.`);

    // Checked after the settings write and any --save, so both still happen even when the
    // install attempt left something missing — a caching failure never undoes the primary write.
    if (this.install && !this.dryRun) {
      assertInstallCached({ report, enabledPluginNames, marketplaceNames, uncachedMarketplaceNames });
    }
  }
}

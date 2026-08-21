import pc from "picocolors";
import { Command } from "./Command.js";
import { ApplyModulesUseCase } from "../../core/ApplyModulesUseCase.js";
import { ModuleListFile } from "../../core/ModuleListFile.js";
import { assertInstallCached } from "../../core/installCheck.js";
import { Scope } from "../../core/types.js";
import { CliError, ModuleNotFoundError } from "../../util/errors.js";
import { Logger } from "../../util/Logger.js";
import { isFile } from "../../util/fsProbe.js";

export class ReloadCommand implements Command {
  constructor(
    private readonly scope: Scope,
    private readonly cwd: string,
    private readonly moduleListFile: ModuleListFile,
    private readonly applyModulesUseCase: ApplyModulesUseCase,
    private readonly logger: Logger,
    private readonly dryRun: boolean,
    private readonly install: boolean,
    /** Explicit list file, bypassing scope-based resolution. Resolved against `cwd` if relative. */
    private readonly filePath?: string
  ) {}

  async execute(): Promise<void> {
    const listFilePath = this.filePath ? await this.resolveExplicitFile() : await this.findScopeFile();

    const moduleNames = await this.moduleListFile.read(listFilePath);
    this.logger.debug(`Reloading modules [${pc.bold(moduleNames.join(", "))}] from ${pc.bold(listFilePath)}.`);
    const { report, enabledPluginNames, marketplaceNames, uncachedMarketplaceNames } = await this.applyModulesUseCase
      .run(moduleNames, this.scope, this.cwd, false, this.install, this.dryRun)
      .catch((err: unknown) => {
        // A plain "Module 'x' does not exist" is disconnected from *why* reload tried to load it —
        // name the list file it came from, since the likely cause is that the module was removed
        // (or the file was hand-edited) after this list was last saved.
        if (err instanceof ModuleNotFoundError) {
          throw new CliError(
            `${err.message} It's listed in ${listFilePath} — edit that file to remove it, or recreate the module.`
          );
        }
        throw err;
      });

    // Mirrors EnableCommand: a caching failure that survives --install fails the run, since
    // --install's whole point is to make the plugin usable, not just to have attempted it.
    if (this.install && !this.dryRun) {
      assertInstallCached({ report, enabledPluginNames, marketplaceNames, uncachedMarketplaceNames });
    }
  }

  private async resolveExplicitFile(): Promise<string> {
    const candidate = this.moduleListFile.resolveExplicitPath(this.cwd, this.filePath!);
    const exists = await isFile(candidate);
    if (!exists) {
      throw new CliError(`No such file: ${candidate}`);
    }
    return candidate;
  }

  /** Reads back whatever `enable --scope <same> --save` wrote — one file per scope. */
  private async findScopeFile(): Promise<string> {
    const found = await this.moduleListFile.find(this.scope, this.cwd);
    if (!found) {
      throw new CliError(
        `No module list found for ${this.scope} scope (looked for ${await this.moduleListFile.searchDescription(
          this.scope,
          this.cwd
        )}). Run 'claude-modules enable <module...> --scope ${this.scope} --save' to create one, or pass ` +
          `--file <path> to read one from elsewhere.`
      );
    }
    return found;
  }
}

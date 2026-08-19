import { stat } from "node:fs/promises";
import pc from "picocolors";
import { Command } from "./Command.js";
import { ApplyModulesUseCase } from "../../core/ApplyModulesUseCase.js";
import { ModuleListFile } from "../../core/ModuleListFile.js";
import { Scope } from "../../core/types.js";
import { CliError } from "../../util/errors.js";
import { Logger } from "../../util/Logger.js";

export class ReloadCommand implements Command {
  constructor(
    private readonly scope: Scope,
    private readonly cwd: string,
    private readonly moduleListFile: ModuleListFile,
    private readonly applyModulesUseCase: ApplyModulesUseCase,
    private readonly logger: Logger,
    private readonly dryRun: boolean,
    /** Explicit list file, bypassing scope-based resolution. Resolved against `cwd` if relative. */
    private readonly filePath?: string
  ) {}

  async execute(): Promise<void> {
    const listFilePath = this.filePath ? await this.resolveExplicitFile() : await this.findScopeFile();

    const moduleNames = await this.moduleListFile.read(listFilePath);
    this.logger.debug(`Reloading modules [${pc.bold(moduleNames.join(", "))}] from ${pc.bold(listFilePath)}.`);
    // install: true — reload has no --install flag of its own; this preserves its pre-existing
    // unconditional best-effort install-cache attempt unchanged.
    await this.applyModulesUseCase.run(moduleNames, this.scope, this.cwd, false, true, this.dryRun);
  }

  private async resolveExplicitFile(): Promise<string> {
    const candidate = this.moduleListFile.resolveExplicitPath(this.cwd, this.filePath!);
    const exists = await stat(candidate)
      .then((s) => s.isFile())
      .catch(() => false);
    if (!exists) {
      throw new CliError(`No such file: ${candidate}`);
    }
    return candidate;
  }

  /** Reads back whatever `enable --scope <same> --persist` wrote — one file per scope. */
  private async findScopeFile(): Promise<string> {
    const found = await this.moduleListFile.find(this.scope, this.cwd);
    if (!found) {
      throw new CliError(
        `No module list found for ${this.scope} scope (looked for ${await this.moduleListFile.searchDescription(
          this.scope,
          this.cwd
        )}). Run 'claude-modules enable <module...> --scope ${this.scope} --persist' to create one, or pass ` +
          `--file <path> to read one from elsewhere.`
      );
    }
    return found;
  }
}

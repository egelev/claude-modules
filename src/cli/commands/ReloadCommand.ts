import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import pc from "picocolors";
import { Command } from "./Command.js";
import { ApplyProfilesUseCase } from "../../core/ApplyProfilesUseCase.js";
import { ProfileListFile } from "../../core/ProfileListFile.js";
import { RepoLocator } from "../../core/RepoLocator.js";
import { Scope } from "../../core/types.js";
import { CliError, RepoRootRequiredError } from "../../util/errors.js";
import { Logger } from "../../util/Logger.js";

export class ReloadCommand implements Command {
  constructor(
    private readonly scope: Scope,
    private readonly cwd: string,
    private readonly repoLocator: RepoLocator,
    private readonly profileListFile: ProfileListFile,
    private readonly applyProfilesUseCase: ApplyProfilesUseCase,
    private readonly logger: Logger,
    private readonly dryRun: boolean,
    /** Explicit list file, bypassing the upward search. Resolved against `cwd` if relative. */
    private readonly filePath?: string
  ) {}

  async execute(): Promise<void> {
    const listFilePath = this.filePath ? await this.resolveExplicitFile() : await this.findFileByUpwardSearch();

    const profileNames = await this.profileListFile.read(listFilePath);
    this.logger.debug(`Reloading profiles [${pc.bold(profileNames.join(", "))}] from ${pc.bold(listFilePath)}.`);
    await this.applyProfilesUseCase.run(profileNames, this.scope, this.cwd, false, this.dryRun);
  }

  private async resolveExplicitFile(): Promise<string> {
    const candidate = resolve(this.cwd, this.filePath!);
    const exists = await stat(candidate)
      .then((s) => s.isFile())
      .catch(() => false);
    if (!exists) {
      throw new CliError(`No such file: ${candidate}`);
    }
    return candidate;
  }

  private async findFileByUpwardSearch(): Promise<string> {
    const repoRoot = await this.repoLocator.findRepoRoot(this.cwd);
    if (!repoRoot) {
      throw new RepoRootRequiredError("reload");
    }

    const listFilePath = await this.profileListFile.findUpward(this.cwd, repoRoot);
    if (!listFilePath) {
      throw new CliError(
        `No .claude-profiles file found between ${this.cwd} and repo root ${repoRoot}. ` +
          `Run 'claude-profiles enable <profile...> --persist' to create one, or pass --file <path> to read one from ` +
          `elsewhere.`
      );
    }
    return listFilePath;
  }
}

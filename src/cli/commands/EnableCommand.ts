import pc from "picocolors";
import { Command } from "./Command.js";
import { ApplyProfilesUseCase } from "../../core/ApplyProfilesUseCase.js";
import { ProfileListFile } from "../../core/ProfileListFile.js";
import { Scope } from "../../core/types.js";
import { Logger } from "../../util/Logger.js";

export class EnableCommand implements Command {
  constructor(
    private readonly profileNames: readonly string[],
    private readonly scope: Scope,
    private readonly only: boolean,
    private readonly persist: boolean,
    private readonly persistPath: string | undefined,
    private readonly cwd: string,
    private readonly applyProfilesUseCase: ApplyProfilesUseCase,
    private readonly profileListFile: ProfileListFile,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const resolvedScope = await this.applyProfilesUseCase.run(
      this.profileNames,
      this.scope,
      this.cwd,
      this.only,
      this.dryRun
    );

    if (this.persist) {
      this.logger.section();
      // Bare --persist (no explicit path) anchors to the same root settings.json was just resolved
      // against, so `reload` finds it regardless of which subdirectory it runs from. An explicit
      // --persist=<path> still resolves against cwd — a typed relative path should mean "relative
      // to me", not silently jump to the repo root.
      const persistBaseDir = this.persistPath !== undefined ? this.cwd : (resolvedScope.repoRoot ?? this.cwd);
      if (this.dryRun) {
        const targetPath = this.profileListFile.resolvePath(persistBaseDir, this.persistPath);
        this.logger.info(`${pc.dim("[dry-run]")} Would persist profile selection to ${pc.bold(targetPath)}.`);
      } else {
        const writtenPath = await this.profileListFile.write(persistBaseDir, this.profileNames, this.persistPath);
        this.logger.info(`Persisted profile selection to ${pc.bold(writtenPath)}.`);
      }
    }
  }
}

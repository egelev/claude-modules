import pc from "picocolors";
import { Command } from "./Command.js";
import { ModuleListFile } from "../../core/ModuleListFile.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { Scope } from "../../core/types.js";
import { Logger } from "../../util/Logger.js";
import { describeError } from "../../util/errors.js";

const CHECKED_SCOPES = [Scope.User, Scope.Project, Scope.Local];

export class RemoveModuleCommand implements Command {
  constructor(
    private readonly name: string,
    private readonly moduleStore: ModuleStore,
    private readonly moduleListFile: ModuleListFile,
    private readonly cwd: string,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    // remove() only ever deletes the module directory — it never touches a saved module list or an
    // already-applied settings.json, so a stale reference is otherwise a silent trap: it surfaces
    // only later, as an unrelated-looking failure from 'enable'/'reload'. This can only check what's
    // locally knowable (this machine's saved lists), not other machines or repos. Checked even when
    // the module is already gone, since a saved list can go stale independently of this command.
    await this.warnIfStillReferenced();

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

  private async warnIfStillReferenced(): Promise<void> {
    for (const scope of CHECKED_SCOPES) {
      const path = await this.moduleListFile.find(scope, this.cwd);
      if (!path) continue;
      let names: string[];
      try {
        names = await this.moduleListFile.read(path);
      } catch (err) {
        this.logger.warn(`Could not read ${pc.bold(path)}: ${describeError(err)}`);
        continue;
      }
      if (names.includes(this.name)) {
        this.logger.warn(
          `Module '${pc.bold(this.name)}' is still listed in ${pc.bold(path)} (${scope} scope) — a later ` +
            `'enable'/'reload' against it will fail until it's removed from that file too.`
        );
      }
    }
  }
}

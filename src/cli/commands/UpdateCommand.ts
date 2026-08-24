import pc from "picocolors";
import { Command } from "./Command.js";
import { ModuleResolver } from "../../core/ModuleResolver.js";
import { ModuleListFile } from "../../core/ModuleListFile.js";
import { ModuleUpdater } from "../../core/ModuleUpdater.js";
import { ModuleNotFoundError } from "../../util/errors.js";
import { Scope } from "../../core/types.js";
import { CliError } from "../../util/errors.js";
import { Logger } from "../../util/Logger.js";

/**
 * Resolves a set of modules' effective (composition-flattened) plugins/marketplaces — the same
 * union `enable`/`disable`/`reload` compute — and asks Claude Code itself to update each one to its
 * latest version, marketplaces first (see ModuleUpdater). Never touches a module's own settings.json
 * or any scope's settings.json: unlike 'enable'/'disable' this doesn't change what's enabled, only
 * what version of it is installed.
 */
export class UpdateCommand implements Command {
  constructor(
    /** Positionals; empty means "use this scope's currently active/saved modules". */
    private readonly moduleNames: readonly string[],
    private readonly scope: Scope,
    private readonly cwd: string,
    private readonly moduleResolver: ModuleResolver,
    private readonly moduleListFile: ModuleListFile,
    private readonly moduleUpdater: ModuleUpdater,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const moduleNames = this.moduleNames.length > 0 ? this.moduleNames : await this.findActiveModules();

    this.logger.debug(`Updating module(s) [${pc.bold(moduleNames.join(", "))}] (scope: ${this.scope}).`);
    const resolved = await this.moduleResolver.resolve(moduleNames).catch((err: unknown) => {
      if (err instanceof ModuleNotFoundError && this.moduleNames.length === 0) {
        throw new CliError(
          `${err.message} It's listed in this scope's saved module list — edit that file to remove it, or ` +
            "recreate the module."
        );
      }
      throw err;
    });

    this.logger.section();
    const result = await this.moduleUpdater.update(resolved, this.scope, this.dryRun);

    this.logger.section();
    if (this.dryRun) {
      this.logger.info(
        `${pc.dim("[dry-run]")} Would attempt to update ${Object.keys(resolved.extraKnownMarketplaces).length} ` +
          `marketplace(s) and ${resolved.enabledPluginNames.size} plugin(s) for module(s) ` +
          `[${pc.bold(moduleNames.join(", "))}]; nothing was actually run.`
      );
    } else {
      this.logger.info(
        `Updated ${result.updatedMarketplaceNames.length} marketplace(s) and ${result.updatedPluginKeys.length} ` +
          `plugin(s) for module(s) [${pc.bold(moduleNames.join(", "))}].`
      );
    }

    this.logger.section();
    this.logger.info(
      "Already running a Claude Code session? Updated plugins take effect on restart, not automatically — " +
        "'claude plugin update' applies on the next launch of Claude Code."
    );

    const failedCount = result.failedMarketplaceNames.length + result.failedPluginKeys.length;
    if (!this.dryRun && failedCount > 0) {
      const parts: string[] = [];
      if (result.failedMarketplaceNames.length > 0) {
        parts.push(`marketplace(s) [${result.failedMarketplaceNames.join(", ")}]`);
      }
      if (result.failedPluginKeys.length > 0) {
        parts.push(`plugin(s) [${result.failedPluginKeys.join(", ")}]`);
      }
      throw new CliError(
        `Failed to update ${parts.join(" and ")} — see the warning(s) above for why.`,
        2
      );
    }
  }

  private async findActiveModules(): Promise<string[]> {
    const found = await this.moduleListFile.find(this.scope, this.cwd);
    if (!found) {
      throw new CliError(
        `No module list found for ${this.scope} scope (looked for ${await this.moduleListFile.searchDescription(
          this.scope,
          this.cwd
        )}). Run 'claude-modules enable <module...> --scope ${this.scope} --save' to create one, or pass ` +
          "module name(s) directly: 'claude-modules update <module...>'."
      );
    }
    const moduleNames = await this.moduleListFile.read(found);
    this.logger.info(
      `Updating currently active module(s) in ${this.scope} scope: [${pc.bold(moduleNames.join(", "))}] (from ${found}).`
    );
    return moduleNames;
  }
}

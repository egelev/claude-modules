import pc from "picocolors";
import { Command } from "./Command.js";
import { ApplyModulesUseCase } from "../../core/ApplyModulesUseCase.js";
import { ModuleListFile } from "../../core/ModuleListFile.js";
import { Scope } from "../../core/types.js";
import { CliError } from "../../util/errors.js";
import { Logger } from "../../util/Logger.js";

export class EnableCommand implements Command {
  constructor(
    private readonly moduleNames: readonly string[],
    private readonly scope: Scope,
    private readonly only: boolean,
    private readonly install: boolean,
    private readonly persist: boolean,
    private readonly persistPath: string | undefined,
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

    if (this.persist) {
      this.logger.section();
      // Bare --persist goes to the canonical location for the scope just applied, so `reload
      // --scope <same>` reads back exactly what was written. An explicit --persist=<path> still
      // resolves against cwd — a typed relative path should mean "relative to me".
      const targetPath =
        this.persistPath !== undefined
          ? this.moduleListFile.resolveExplicitPath(this.cwd, this.persistPath)
          : await this.moduleListFile.pathFor(this.scope, this.cwd);

      if (this.dryRun) {
        this.logger.info(`${pc.dim("[dry-run]")} Would persist module selection to ${pc.bold(targetPath)}.`);
      } else {
        await this.moduleListFile.write(targetPath, this.moduleNames);
        this.logger.info(`Persisted module selection to ${pc.bold(targetPath)}.`);
      }
    }

    // Checked after the settings write and any --persist, so both still happen even when the
    // install attempt left something missing — a caching failure never undoes the primary write.
    if (this.install && !this.dryRun) {
      const uncachedMarketplaces = new Set(uncachedMarketplaceNames);
      const stillMissingMarketplaces = [...marketplaceNames].filter((name) => uncachedMarketplaces.has(name)).sort();
      const uncachedPlugins = new Set(report.uncachedPluginKeys);
      const stillMissingPlugins = [...enabledPluginNames].filter((key) => uncachedPlugins.has(key)).sort();

      const messages: string[] = [];
      if (stillMissingMarketplaces.length > 0) {
        messages.push(
          `${stillMissingMarketplaces.length} marketplace(s) from this module selection are still not known to ` +
            `Claude Code after --install: ${stillMissingMarketplaces.join(", ")}. See the warnings above for why, or ` +
            `add manually with 'claude plugin marketplace add <source> --scope user'.`
        );
      }
      if (stillMissingPlugins.length > 0) {
        messages.push(
          `${stillMissingPlugins.length} plugin(s) from this module selection are still not cached by Claude Code ` +
            `after --install: ${stillMissingPlugins.join(", ")}. See the warnings above for why, or install manually ` +
            `with 'claude plugin install <plugin>@<marketplace> --scope user -y'.`
        );
      }
      if (messages.length > 0) {
        throw new CliError(messages.join("\n\n"), 2);
      }
    }
  }
}

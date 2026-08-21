import pc from "picocolors";
import { ModuleListFile } from "./ModuleListFile.js";
import { ModuleResolver } from "./ModuleResolver.js";
import { ClaudeSettings, Scope } from "./types.js";
import { Logger } from "../util/Logger.js";
import { describeError } from "../util/errors.js";

export interface ModuleDriftReport {
  /** A `.claude-modules` file was found, but its listed modules couldn't be read/resolved. */
  resolutionFailed: boolean;
  /** Plugin keys the listed module(s) want enabled, but aren't (absent or explicitly false). */
  missingPluginKeys: string[];
  /** Plugin keys enabled in the target scope that no listed module declares. */
  stalePluginKeys: string[];
}

const NO_DRIFT: ModuleDriftReport = { resolutionFailed: false, missingPluginKeys: [], stalePluginKeys: [] };

/**
 * Used only by `status`: compares a scope's live settings.json against what its `.claude-modules`
 * file (if any) says should be enabled. Kept separate from `EnabledPluginsReporter`, which
 * `disable`/`disable-all` also depend on — those commands intentionally deviate from full module
 * application, so a module-drift check would misreport their result as broken.
 */
export class ModuleDriftReporter {
  constructor(
    private readonly moduleListFile: ModuleListFile,
    private readonly moduleResolver: ModuleResolver,
    private readonly logger: Logger
  ) {}

  /**
   * Reads the list belonging to `scope` — the same file `enable --scope <scope> --save` wrote,
   * resolved through `ModuleListFile` so the two can't disagree. Discovery used to be scope-blind,
   * which meant `status --scope user` graded itself against a repository's list.
   */
  async report(
    scope: Scope,
    settingsPath: string,
    settings: ClaudeSettings,
    cwd: string,
    quiet = false
  ): Promise<ModuleDriftReport> {
    if (!quiet) this.logger.section();
    const listFilePath = await this.moduleListFile.find(scope, cwd);
    if (!listFilePath) {
      if (!quiet) {
        this.logger.info(
          `No module list found for ${scope} scope (${pc.bold(settingsPath)}) — skipping module-drift check.`
        );
      }
      return NO_DRIFT;
    }

    let moduleNames: string[];
    try {
      moduleNames = await this.moduleListFile.read(listFilePath);
    } catch (err) {
      if (!quiet) {
        this.logger.warn(`Could not read ${pc.bold(listFilePath)}: ${describeError(err)}`);
      }
      return { ...NO_DRIFT, resolutionFailed: true };
    }

    if (moduleNames.length === 0) {
      if (!quiet) {
        this.logger.info(
          `${pc.bold(listFilePath)} lists no modules — nothing to compare against ${scope} scope (${pc.bold(settingsPath)}).`
        );
      }
      return NO_DRIFT;
    }

    let enabledPluginNames: Set<string>;
    try {
      ({ enabledPluginNames } = await this.moduleResolver.resolve(moduleNames));
    } catch (err) {
      if (!quiet) {
        this.logger.warn(
          `Could not resolve listed module(s) [${pc.bold(moduleNames.join(", "))}] from ${pc.bold(listFilePath)}: ` +
            describeError(err)
        );
      }
      return { ...NO_DRIFT, resolutionFailed: true };
    }

    const existing = settings.enabledPlugins ?? {};
    const missingPluginKeys = [...enabledPluginNames].filter((key) => existing[key] !== true).sort();
    const stalePluginKeys = Object.keys(existing)
      .filter((key) => existing[key] === true && !enabledPluginNames.has(key))
      .sort();

    if (!quiet) {
      const header = `Module list ${pc.bold(listFilePath)} (modules: ${moduleNames.join(", ")}) vs ${scope} scope (${pc.bold(settingsPath)}):`;
      if (missingPluginKeys.length === 0 && stalePluginKeys.length === 0) {
        this.logger.info(`${header}\n  In sync — every enabled plugin matches the listed module(s).`);
      } else {
        const summaryLines: string[] = [];
        if (missingPluginKeys.length > 0) {
          summaryLines.push(
            `  Missing (${missingPluginKeys.length}) — wanted by the listed module(s) but not enabled: ` +
              missingPluginKeys.map((key) => pc.bold(key)).join(", ")
          );
        }
        if (stalePluginKeys.length > 0) {
          summaryLines.push(
            `  Stale (${stalePluginKeys.length}) — enabled, but no listed module declares them: ` +
              stalePluginKeys.map((key) => pc.bold(key)).join(", ")
          );
        }
        this.logger.info(`${header}\n${summaryLines.join("\n")}`);
      }
    }

    return { resolutionFailed: false, missingPluginKeys, stalePluginKeys };
  }
}

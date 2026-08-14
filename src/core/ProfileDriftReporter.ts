import { RepoLocator } from "./RepoLocator.js";
import { ProfileListFile } from "./ProfileListFile.js";
import { ProfileResolver } from "./ProfileResolver.js";
import { ClaudeSettings, Scope } from "./types.js";
import { Logger } from "../util/Logger.js";

export interface ProfileDriftReport {
  /** A `.claude-profiles` file was found, but its listed profiles couldn't be read/resolved. */
  resolutionFailed: boolean;
  /** Plugin keys the listed profile(s) want enabled, but aren't (absent or explicitly false). */
  missingPluginKeys: string[];
  /** Plugin keys enabled in the target scope that no listed profile declares. */
  stalePluginKeys: string[];
}

const NO_DRIFT: ProfileDriftReport = { resolutionFailed: false, missingPluginKeys: [], stalePluginKeys: [] };

/**
 * Used only by `status`: compares a scope's live settings.json against what its `.claude-profiles`
 * file (if any) says should be enabled. Kept separate from `EnabledPluginsReporter`, which
 * `disable`/`disable-all` also depend on — those commands intentionally deviate from full profile
 * application, so a profile-drift check would misreport their result as broken.
 */
export class ProfileDriftReporter {
  constructor(
    private readonly repoLocator: RepoLocator,
    private readonly profileListFile: ProfileListFile,
    private readonly profileResolver: ProfileResolver,
    private readonly logger: Logger
  ) {}

  /**
   * Discovery matches `reload`: scope-blind, walking up from `cwd` to the repo root if one exists.
   * Only when no repo exists at all does this fall back to checking `cwd` directly — the one case
   * `reload` can't handle, since bare `enable --scope user --persist` writes there.
   */
  async report(
    scope: Scope,
    settingsPath: string,
    settings: ClaudeSettings,
    cwd: string
  ): Promise<ProfileDriftReport> {
    const listFilePath = await this.findListFile(cwd);
    if (!listFilePath) {
      this.logger.info(
        `No .claude-profiles file found for ${scope} scope (${settingsPath}) — skipping profile-drift check.`
      );
      return NO_DRIFT;
    }

    let profileNames: string[];
    try {
      profileNames = await this.profileListFile.read(listFilePath);
    } catch (err) {
      this.logger.warn(`Could not read ${listFilePath}: ${err instanceof Error ? err.message : String(err)}`);
      return { ...NO_DRIFT, resolutionFailed: true };
    }

    if (profileNames.length === 0) {
      this.logger.info(`${listFilePath} lists no profiles — nothing to compare against ${scope} scope (${settingsPath}).`);
      return NO_DRIFT;
    }

    let enabledPluginNames: Set<string>;
    try {
      ({ enabledPluginNames } = await this.profileResolver.resolve(profileNames));
    } catch (err) {
      this.logger.warn(
        `Could not resolve listed profile(s) [${profileNames.join(", ")}] from ${listFilePath}: ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
      return { ...NO_DRIFT, resolutionFailed: true };
    }

    const existing = settings.enabledPlugins ?? {};
    const missingPluginKeys = [...enabledPluginNames].filter((key) => existing[key] !== true).sort();
    const stalePluginKeys = Object.keys(existing)
      .filter((key) => existing[key] === true && !enabledPluginNames.has(key))
      .sort();

    this.logger.info(
      `Profile list ${listFilePath} (profiles: ${profileNames.join(", ")}) vs ${scope} scope (${settingsPath}):`
    );
    this.logger.info(
      `Missing in ${scope} scope — the listed profile(s) want these enabled, but they aren't:\n${bulletList(missingPluginKeys)}`
    );
    this.logger.info(
      `Stale in ${scope} scope — enabled, but no listed profile declares them:\n${bulletList(stalePluginKeys)}`
    );

    return { resolutionFailed: false, missingPluginKeys, stalePluginKeys };
  }

  private async findListFile(cwd: string): Promise<string | null> {
    const repoRoot = await this.repoLocator.findRepoRoot(cwd);
    return repoRoot ? this.profileListFile.findUpward(cwd, repoRoot) : this.profileListFile.findAt(cwd);
  }
}

function bulletList(keys: readonly string[]): string {
  return keys.length > 0 ? keys.map((key) => `  - ${key}`).join("\n") : "  (none)";
}

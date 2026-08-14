import { Command } from "./Command.js";
import { ScopeResolver } from "../../core/ScopeResolver.js";
import { SettingsRepository } from "../../core/SettingsRepository.js";
import { EnabledPluginsReporter } from "../../core/EnabledPluginsReporter.js";
import { ProfileDriftReporter } from "../../core/ProfileDriftReporter.js";
import { Scope } from "../../core/types.js";
import { CliError } from "../../util/errors.js";
import { Logger } from "../../util/Logger.js";

/**
 * Read-only audit of live settings.json state against two independent sources of truth:
 * Claude Code's own plugin cache (the check `install`/`enable`/`reload` can't give you after the
 * fact, since their caching step is best-effort and a failure there doesn't stop the settings
 * write), and — if a `.claude-profiles` file applies to this scope — the profiles it lists (the
 * check that catches settings.json drifting away from a profile that was hand-edited, or a
 * profile dropped from the list without ever re-running `reload`). Exits non-zero when either
 * kind of drift is found, so this is usable as a CI/pre-session gate, not just a log line to
 * notice in the moment.
 */
export class StatusCommand implements Command {
  constructor(
    private readonly scope: Scope,
    private readonly cwd: string,
    private readonly scopeResolver: ScopeResolver,
    private readonly settingsRepository: SettingsRepository,
    private readonly enabledPluginsReporter: EnabledPluginsReporter,
    private readonly profileDriftReporter: ProfileDriftReporter,
    private readonly logger: Logger
  ) {}

  async execute(): Promise<void> {
    const resolved = await this.scopeResolver.resolve(this.scope, this.cwd);
    const settings = await this.settingsRepository.read(resolved.settingsPath);

    // Both checks run (and both report) before anything is thrown, so cache drift never hides
    // profile drift (or vice versa) by short-circuiting the other's output.
    const { uncachedPluginKeys } = await this.enabledPluginsReporter.report(
      this.scope,
      resolved.settingsPath,
      settings,
      this.cwd,
      false
    );
    const profileDrift = await this.profileDriftReporter.report(this.scope, resolved.settingsPath, settings, this.cwd);

    const problems: string[] = [];
    if (uncachedPluginKeys.length > 0) {
      problems.push(
        `${uncachedPluginKeys.length} enabled plugin(s) are not cached by Claude Code and would fail a new ` +
          `session with 'not cached': ${uncachedPluginKeys.join(", ")}. Run 'claude-profiles enable'/'reload' to ` +
          `re-cache them, or install each manually with 'claude plugin install <plugin>@<marketplace> --scope user'.`
      );
    }
    if (profileDrift.resolutionFailed) {
      problems.push("Could not resolve the listed profile(s) against this scope — see the warning above.");
    }
    if (profileDrift.missingPluginKeys.length > 0) {
      problems.push(
        `${profileDrift.missingPluginKeys.length} plugin(s) expected by the listed profile(s) aren't enabled in ` +
          `${this.scope} scope: ${profileDrift.missingPluginKeys.join(", ")}. Run 'claude-profiles reload' to apply them.`
      );
    }
    if (profileDrift.stalePluginKeys.length > 0) {
      problems.push(
        `${profileDrift.stalePluginKeys.length} plugin(s) enabled in ${this.scope} scope aren't declared by any ` +
          `listed profile: ${profileDrift.stalePluginKeys.join(", ")}. Run 'claude-profiles reload' to prune them, ` +
          `or update the profile(s)/.claude-profiles if this is intentional.`
      );
    }

    if (problems.length > 0) {
      // Distinct from the default exitCode 1 (couldn't run at all, e.g. ScopeRequiredError) so a
      // CI/pre-session caller can tell "drift found" apart from "status itself failed".
      this.logger.section();
      const message = problems.map((problem, i) => (i === 0 ? problem : `  ${problem}`)).join("\n\n");
      throw new CliError(message, 2);
    }
    this.logger.info(
      "All effectively-enabled plugins are cached by Claude Code, and settings.json matches the listed profile(s) (if any)."
    );
  }
}

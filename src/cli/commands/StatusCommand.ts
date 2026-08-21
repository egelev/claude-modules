import { Command } from "./Command.js";
import { ScopeResolver } from "../../core/ScopeResolver.js";
import { SettingsRepository } from "../../core/SettingsRepository.js";
import { EnabledPluginsReporter } from "../../core/EnabledPluginsReporter.js";
import { ModuleDriftReporter } from "../../core/ModuleDriftReporter.js";
import { EnabledPluginsVerifier } from "../../core/EnabledPluginsVerifier.js";
import { ModuleListFile } from "../../core/ModuleListFile.js";
import { Scope } from "../../core/types.js";
import { CliError, describeError } from "../../util/errors.js";
import { Logger } from "../../util/Logger.js";

interface StatusJsonPayload {
  ok: boolean;
  scope: Scope;
  settingsPath: string;
  checks: {
    cache: { uncachedPluginKeys: string[] };
    moduleList: {
      listFilePath: string | null;
      resolutionFailed: boolean;
      missingPluginKeys: string[];
      stalePluginKeys: string[];
    };
    verify:
      | null
      | {
          ran: true;
          unavailable: boolean;
          unexpectedlyEnabled: string[];
          unexpectedlyDisabled: string[];
        };
  };
}

/**
 * Read-only audit of live settings.json state against two independent sources of truth:
 * Claude Code's own plugin cache (the check `plugin install`/`enable --install`/`reload` can't give you after the
 * fact, since their caching step is best-effort and a failure there doesn't stop the settings
 * write), and — if a `.claude-modules` file applies to this scope — the modules it lists (the
 * check that catches settings.json drifting away from a module that was hand-edited, or a
 * module dropped from the list without ever re-running `reload`). Exits non-zero when either
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
    private readonly moduleDriftReporter: ModuleDriftReporter,
    private readonly moduleListFile: ModuleListFile,
    private readonly logger: Logger,
    /** Opt-in third check: cross-examine Claude Code's own resolution. Costs a subprocess. */
    private readonly verify: boolean,
    private readonly enabledPluginsVerifier: EnabledPluginsVerifier,
    /** Print one JSON object to stdout instead of the human-readable report; exit code unchanged. */
    private readonly json: boolean
  ) {}

  async execute(): Promise<void> {
    let resolved;
    try {
      resolved = await this.scopeResolver.resolve(this.scope, this.cwd);
    } catch (err) {
      // Every other failure path below still emits a JSON payload before throwing (or exits via the
      // `problems.length > 0` branch, which also emits first) — a scope-resolution failure is the one
      // path that used to throw before any JSON-emission code ran, leaving a CI script that
      // unconditionally JSON.parse(stdout)s with an empty string instead of a clean signal.
      if (this.json) {
        process.stdout.write(`${JSON.stringify({ ok: false, error: describeError(err) })}\n`);
      }
      throw err;
    }
    const settings = await this.settingsRepository.read(resolved.settingsPath);

    // Every check runs (and reports) before anything is thrown, so no one kind of drift hides
    // another by short-circuiting its output.
    const { uncachedPluginKeys, effectivelyEnabledPluginKeys } = await this.enabledPluginsReporter.report(
      this.scope,
      resolved.settingsPath,
      settings,
      this.cwd,
      false,
      this.json
    );
    const moduleDrift = await this.moduleDriftReporter.report(
      this.scope,
      resolved.settingsPath,
      settings,
      this.cwd,
      this.json
    );
    const verification = this.verify
      ? await this.enabledPluginsVerifier.verify(effectivelyEnabledPluginKeys, this.json)
      : undefined;

    const problems: string[] = [];
    if (uncachedPluginKeys.length > 0) {
      problems.push(
        `${uncachedPluginKeys.length} enabled plugin(s) are not cached by Claude Code and would fail a new ` +
          `session with 'not cached': ${uncachedPluginKeys.join(", ")}. Run 'claude-modules enable --install'/'reload' to ` +
          `re-cache them, or install each manually with 'claude plugin install <plugin>@<marketplace> --scope user'.`
      );
    }
    if (moduleDrift.resolutionFailed) {
      problems.push("Could not resolve the listed module(s) against this scope — see the warning above.");
    }
    if (moduleDrift.missingPluginKeys.length > 0) {
      problems.push(
        `${moduleDrift.missingPluginKeys.length} plugin(s) expected by the listed module(s) aren't enabled in ` +
          `${this.scope} scope: ${moduleDrift.missingPluginKeys.join(", ")}. Run 'claude-modules reload' to apply them.`
      );
    }
    if (moduleDrift.stalePluginKeys.length > 0) {
      problems.push(
        `${moduleDrift.stalePluginKeys.length} plugin(s) enabled in ${this.scope} scope aren't declared by any ` +
          `listed module: ${moduleDrift.stalePluginKeys.join(", ")}. Run 'claude-modules reload' to prune them, ` +
          `or update the module(s)/.claude-modules if this is intentional.`
      );
    }
    if (verification !== undefined && !verification.unavailable) {
      // A disagreement here means something outside this tool's model is deciding — almost always
      // a managed-settings policy, which outranks user/project/local and can't be read from here.
      if (verification.unexpectedlyDisabled.length > 0) {
        problems.push(
          `${verification.unexpectedlyDisabled.length} plugin(s) this tool considers enabled are reported disabled ` +
            `by Claude Code: ${verification.unexpectedlyDisabled.join(", ")}. A managed-settings policy is the ` +
            `usual cause — these will not load in a session regardless of what settings.json says.`
        );
      }
      if (verification.unexpectedlyEnabled.length > 0) {
        problems.push(
          `${verification.unexpectedlyEnabled.length} plugin(s) are reported enabled by Claude Code but aren't ` +
            `accounted for by this tool's scope resolution: ${verification.unexpectedlyEnabled.join(", ")}. These ` +
            `load in a session without any module asking for them.`
        );
      }
    }

    if (this.json) {
      const listFilePath = (await this.moduleListFile.find(this.scope, this.cwd)) ?? null;
      const payload: StatusJsonPayload = {
        ok: problems.length === 0,
        scope: this.scope,
        settingsPath: resolved.settingsPath,
        checks: {
          cache: { uncachedPluginKeys },
          moduleList: {
            listFilePath,
            resolutionFailed: moduleDrift.resolutionFailed,
            missingPluginKeys: moduleDrift.missingPluginKeys,
            stalePluginKeys: moduleDrift.stalePluginKeys,
          },
          verify:
            verification === undefined
              ? null
              : {
                  ran: true,
                  unavailable: verification.unavailable,
                  unexpectedlyEnabled: verification.unexpectedlyEnabled,
                  unexpectedlyDisabled: verification.unexpectedlyDisabled,
                },
        },
      };
      // Bypasses Logger entirely (same as --version) so no color code, "Warning:"/"Error:" prefix,
      // or section-break blank line can leak into stdout.
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    }

    if (problems.length > 0) {
      // Distinct from the default exitCode 1 (couldn't run at all, e.g. ScopeRequiredError) so a
      // CI/pre-session caller can tell "drift found" apart from "status itself failed". In --json
      // mode this still lands on stderr (Logger sends WARN/ERROR there), so a script reading only
      // stdout sees the JSON printed above either way.
      this.logger.section();
      const message = problems.map((problem, i) => (i === 0 ? problem : `  ${problem}`)).join("\n\n");
      throw new CliError(message, 2);
    }

    if (!this.json) {
      this.logger.section();
      const verified =
        verification !== undefined && !verification.unavailable
          ? " Claude Code's own resolution agrees."
          : "";
      this.logger.info(
        "All effectively-enabled plugins are cached by Claude Code, and settings.json matches the listed module(s) " +
          `(if any).${verified}`
      );
    }
  }
}

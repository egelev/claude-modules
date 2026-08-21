import pc from "picocolors";
import { ClaudeRunner, defaultClaudeRunner } from "./ClaudeRunner.js";
import { Logger } from "../util/Logger.js";

export interface VerifyReport {
  /** The verification couldn't run at all (no `claude` on PATH, bad output, ...). Not drift. */
  unavailable: boolean;
  /** Claude Code reports these as enabled, but this tool's own resolution does not. */
  unexpectedlyEnabled: string[];
  /** This tool considers these effectively enabled, but Claude Code reports them disabled. */
  unexpectedlyDisabled: string[];
}

const NOT_RUN: VerifyReport = { unavailable: true, unexpectedlyEnabled: [], unexpectedlyDisabled: [] };

/** One row of `claude plugin list --json`; there is one row per install scope, sharing `enabled`. */
interface PluginListEntry {
  id?: string;
  enabled?: boolean;
}

/**
 * Cross-checks this tool's computed "effectively enabled" set against Claude Code's own resolution,
 * via `claude plugin list --json`.
 *
 * This matters because `EnabledPluginsReporter` models precedence as local > project > user, which
 * is correct as far as it goes but cannot see **managed settings** — an administrator's policy file
 * outranks all three and can force a plugin on or off. Against a managed machine, this tool's report
 * would otherwise be confidently wrong with no way to notice.
 *
 * Both sides describe the same thing — what a session started in this directory loads — for any
 * audited scope, because the reporter walks the whole applicable chain rather than stopping at the
 * scope under audit. That is what lets `--verify` behave identically at `user`, `project`, and
 * `local`; an earlier version compared a truncated set and had to be restricted to `local` to avoid
 * inventing drift.
 *
 * Opt-in (`status --verify`) rather than always-on, because it costs a subprocess and a few hundred
 * milliseconds, and `status`'s default promise is that it runs nothing external.
 */
export class EnabledPluginsVerifier {
  constructor(
    private readonly logger: Logger,
    private readonly env: NodeJS.ProcessEnv,
    private readonly runClaude: ClaudeRunner = defaultClaudeRunner
  ) {}

  async verify(effectivelyEnabled: ReadonlySet<string>, quiet = false): Promise<VerifyReport> {
    const result = await this.runClaude(["plugin", "list", "--json"], this.env);
    if (!result.ok) {
      if (!quiet) {
        this.logger.warn(
          `Could not verify against Claude Code's own plugin resolution (${result.detail}).\n  ` +
            `Reporting this tool's computed state only — re-run without --verify to skip this check.`
        );
      }
      return NOT_RUN;
    }

    const claudeEnabled = this.parseEnabled(result.stdout);
    if (claudeEnabled === undefined) {
      if (!quiet) {
        this.logger.warn(
          "Could not parse 'claude plugin list --json' output — skipping the cross-check. This usually means the " +
            "installed Claude Code version reports a different shape than expected."
        );
      }
      return NOT_RUN;
    }

    // Only plugins Claude Code actually knows about are compared. One that is enabled in
    // settings.json but was never installed simply doesn't appear here — that is the "not cached"
    // condition, already reported separately, and not a precedence disagreement.
    const unexpectedlyEnabled = [...claudeEnabled.enabled].filter((key) => !effectivelyEnabled.has(key)).sort();
    const unexpectedlyDisabled = [...effectivelyEnabled]
      .filter((key) => claudeEnabled.known.has(key) && !claudeEnabled.enabled.has(key))
      .sort();

    if (!quiet) {
      this.logger.section();
      if (unexpectedlyEnabled.length === 0 && unexpectedlyDisabled.length === 0) {
        this.logger.info(
          "Verified against Claude Code's own resolution of what a session in this directory would load — no disagreement."
        );
      } else {
        const summaryLines: string[] = [];
        if (unexpectedlyEnabled.length > 0) {
          summaryLines.push(
            `  Claude Code reports these as enabled, but this tool's scope resolution does not: ` +
              unexpectedlyEnabled.map((key) => pc.bold(key)).join(", ")
          );
        }
        if (unexpectedlyDisabled.length > 0) {
          summaryLines.push(
            `  This tool considers these enabled, but Claude Code reports them disabled: ` +
              unexpectedlyDisabled.map((key) => pc.bold(key)).join(", ")
          );
        }
        summaryLines.push(
          "  A managed-settings policy is the usual cause: it outranks user/project/local and this tool cannot read it."
        );
        this.logger.info(
          `Verified against Claude Code's own resolution of what a session in this directory would load ` +
            `(${pc.bold("claude plugin list --json")}):\n${summaryLines.join("\n")}`
        );
      }
    }

    return { unavailable: false, unexpectedlyEnabled, unexpectedlyDisabled };
  }

  /**
   * `claude plugin list --json` emits one row per install scope, each carrying the same *resolved*
   * `enabled` value for that plugin id — so a plugin counts as enabled if any of its rows says so.
   */
  private parseEnabled(stdout: string): { known: Set<string>; enabled: Set<string> } | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return undefined;
    }
    if (!Array.isArray(parsed)) return undefined;

    const known = new Set<string>();
    const enabled = new Set<string>();
    for (const entry of parsed as PluginListEntry[]) {
      if (typeof entry?.id !== "string") continue;
      known.add(entry.id);
      if (entry.enabled === true) enabled.add(entry.id);
    }
    return { known, enabled };
  }
}

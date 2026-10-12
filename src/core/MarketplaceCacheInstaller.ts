import pc from "picocolors";
import { dryRunTag } from "../util/outputStyle.js";
import { KnownMarketplacesCache } from "./KnownMarketplacesCache.js";
import { marketplaceAddPlan } from "./marketplaceSpec.js";
import { ClaudeRunner, defaultClaudeRunner } from "./ClaudeRunner.js";
import { MarketplaceSource, Scope } from "./types.js";
import { Logger } from "../util/Logger.js";

/**
 * Ensures marketplaces declared by an enabled module are actually known to Claude Code's own
 * known_marketplaces.json, by shelling out to `claude plugin marketplace add` — mirrors
 * PluginCacheInstaller. Best-effort: every failure path is a logged warning, never a thrown error,
 * since the settings write this runs alongside is the primary, reliable operation.
 */
export class MarketplaceCacheInstaller {
  constructor(
    private readonly knownMarketplacesCache: KnownMarketplacesCache,
    private readonly logger: Logger,
    private readonly env: NodeJS.ProcessEnv,
    private readonly runClaude: ClaudeRunner = defaultClaudeRunner
  ) {}

  /** `scope` defaults to `user`; `enable --install`/`reload --install` pass the real target scope
   * instead, since `claude plugin marketplace add` writes its entry at whatever scope this runs with. */
  async ensureCached(
    marketplaces: Readonly<Record<string, MarketplaceSource>>,
    dryRun: boolean,
    scope: Scope = Scope.User
  ): Promise<void> {
    for (const [name, source] of Object.entries(marketplaces)) {
      if ((await this.knownMarketplacesCache.get(name)) !== undefined) {
        this.logger.debug(`Marketplace '${pc.bold(name)}' already known to Claude Code.`);
        continue;
      }
      if (dryRun) {
        const plan = marketplaceAddPlan(source);
        const action =
          plan.kind === "cli"
            ? `would run 'claude plugin marketplace add ${plan.args.join(" ")} --scope ${scope}'`
            : plan.kind === "from-settings"
              ? `nothing to run: it has ${plan.description}, which Claude Code registers itself from ` +
                "settings.json at the next session start"
              : "would need manual addition — its source isn't a shape this tool can convert to a CLI spec";
        this.logger.info(`${dryRunTag()} Marketplace '${pc.bold(name)}' isn't known to Claude Code — ${action}.`);
        continue;
      }
      await this.installOne(name, source, scope);
    }
  }

  /** Fresh as-of-now check — which of `marketplaces` are still unknown to Claude Code. */
  async missing(marketplaces: Readonly<Record<string, MarketplaceSource>>): Promise<string[]> {
    const result: string[] = [];
    for (const name of Object.keys(marketplaces)) {
      if ((await this.knownMarketplacesCache.get(name)) === undefined) result.push(name);
    }
    return result.sort();
  }

  private async installOne(name: string, source: MarketplaceSource, scope: Scope): Promise<void> {
    const plan = marketplaceAddPlan(source);
    if (plan.kind === "from-settings") {
      // Not a failure: there's no CLI form to run, and none is needed — the settings write is what
      // registers it. Info, not a warning, so a portable module doesn't read as broken.
      this.logger.info(
        `Marketplace '${pc.bold(name)}' isn't known to Claude Code yet. It has ${plan.description}, which ` +
          `'claude plugin marketplace add' can't express,\n  so Claude Code registers it itself from settings.json ` +
          `at the next session start in a scope that declares it (e.g. after 'enable').`
      );
      return;
    }
    if (plan.kind === "unknown") {
      this.logger.warn(
        `Marketplace '${pc.bold(name)}' isn't known to Claude Code, and its source isn't a shape this tool can ` +
          `turn into a 'claude plugin marketplace add' command automatically.\n  Add it manually, then retry.`
      );
      return;
    }

    const spec = plan.args.join(" ");
    const result = await this.runClaude(["plugin", "marketplace", "add", ...plan.args, "--scope", scope], this.env);
    if (result.ok) {
      this.logger.info(
        `Marketplace '${pc.bold(name)}' wasn't known to Claude Code yet — added it now via ` +
          `'claude plugin marketplace add' (scope: ${scope}).`
      );
    } else {
      this.logger.warn(
        `Failed to add marketplace '${pc.bold(name)}' to Claude Code (${result.detail}).\n  It's declared in the ` +
          `module/settings, but plugin installs from it may fail until you run ` +
          `'claude plugin marketplace add ${spec} --scope ${scope}' manually.`
      );
    }
  }
}

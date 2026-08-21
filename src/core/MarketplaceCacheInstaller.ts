import pc from "picocolors";
import { KnownMarketplacesCache } from "./KnownMarketplacesCache.js";
import { marketplaceSpecFromSource } from "./marketplaceSpec.js";
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
        const spec = marketplaceSpecFromSource(source);
        const action =
          spec !== undefined
            ? `would run 'claude plugin marketplace add ${spec} --scope ${scope}'`
            : "would need manual addition — its source isn't a shape this tool can convert to a CLI spec";
        this.logger.info(`${pc.dim("[dry-run]")} Marketplace '${pc.bold(name)}' isn't known to Claude Code — ${action}.`);
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
    const spec = marketplaceSpecFromSource(source);
    if (spec === undefined) {
      this.logger.warn(
        `Marketplace '${pc.bold(name)}' isn't known to Claude Code, and its source isn't a shape this tool can ` +
          `turn into a 'claude plugin marketplace add' command automatically.\n  Add it manually, then retry.`
      );
      return;
    }

    const result = await this.runClaude(["plugin", "marketplace", "add", spec, "--scope", scope], this.env);
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

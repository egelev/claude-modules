import pc from "picocolors";
import { dryRunTag } from "../util/outputStyle.js";
import { ClaudeRunner, defaultClaudeRunner } from "./ClaudeRunner.js";
import { KnownMarketplacesCache } from "./KnownMarketplacesCache.js";
import { marketplaceAddPlan } from "./marketplaceSpec.js";
import { ResolvedModules } from "./moduleUnion.js";
import { marketplaceOfPluginKey } from "./pluginKey.js";
import { MarketplaceSource, Scope } from "./types.js";
import { Logger } from "../util/Logger.js";

export interface ModuleUpdateResult {
  updatedMarketplaceNames: string[];
  failedMarketplaceNames: string[];
  updatedPluginKeys: string[];
  failedPluginKeys: string[];
}

/**
 * Drives 'claude plugin marketplace update'/'claude plugin update' for a resolved module union —
 * the update-to-latest counterpart of PluginCacheInstaller/MarketplaceCacheInstaller's "make sure
 * it's cached at all". Marketplaces are always updated before plugins, mirroring
 * ApplyModulesUseCase's --install ordering, so a plugin whose marketplace just moved still gets a
 * chance at a fresh update in the same run. Best-effort per item: one failure is a logged warning,
 * never a thrown error, so the rest of the run still gets attempted — the caller decides whether
 * any failure should affect the process exit code. A marketplace Claude Code hasn't registered yet,
 * and only can from settings.json (see `marketplaceAddPlan`), is skipped with its plugins rather than
 * failed: until the next session start registers it, there's nothing to update.
 */
export class ModuleUpdater {
  constructor(
    private readonly knownMarketplacesCache: KnownMarketplacesCache,
    private readonly logger: Logger,
    private readonly env: NodeJS.ProcessEnv,
    private readonly runClaude: ClaudeRunner = defaultClaudeRunner
  ) {}

  async update(resolved: ResolvedModules, scope: Scope, dryRun: boolean): Promise<ModuleUpdateResult> {
    const marketplaceNames = Object.keys(resolved.extraKnownMarketplaces).sort();
    const pluginKeys = [...resolved.enabledPluginNames].sort();

    const pending = await this.pendingSettingsMarketplaces(resolved.extraKnownMarketplaces);

    const updatedMarketplaceNames: string[] = [];
    const failedMarketplaceNames: string[] = [];
    for (const name of marketplaceNames) {
      if (pending.has(name)) {
        this.logger.info(
          `Skipping marketplace '${pc.bold(name)}' and its plugins: Claude Code registers it from settings.json ` +
            "at the next session start, so there's nothing to update yet."
        );
        continue;
      }
      if (dryRun) {
        this.logger.info(
          `${dryRunTag()} Would run 'claude plugin marketplace update ${name}'.`
        );
        continue;
      }
      if (await this.updateMarketplace(name)) updatedMarketplaceNames.push(name);
      else failedMarketplaceNames.push(name);
    }

    const updatedPluginKeys: string[] = [];
    const failedPluginKeys: string[] = [];
    for (const pluginKey of pluginKeys) {
      if (pending.has(marketplaceOfPluginKey(pluginKey) ?? "")) {
        this.logger.debug(`Skipping '${pc.bold(pluginKey)}': its marketplace isn't registered with Claude Code yet.`);
        continue;
      }
      if (dryRun) {
        this.logger.info(
          `${dryRunTag()} Would run 'claude plugin update ${pluginKey} --scope ${scope} -y'.`
        );
        continue;
      }
      if (await this.updatePlugin(pluginKey, scope)) updatedPluginKeys.push(pluginKey);
      else failedPluginKeys.push(pluginKey);
    }

    return { updatedMarketplaceNames, failedMarketplaceNames, updatedPluginKeys, failedPluginKeys };
  }

  /** Declared marketplaces Claude Code doesn't know yet whose source only settings.json can express. */
  private async pendingSettingsMarketplaces(
    marketplaces: Readonly<Record<string, MarketplaceSource>>
  ): Promise<Set<string>> {
    const pending = new Set<string>();
    for (const [name, source] of Object.entries(marketplaces)) {
      if (marketplaceAddPlan(source).kind !== "from-settings") continue;
      if ((await this.knownMarketplacesCache.get(name)) === undefined) pending.add(name);
    }
    return pending;
  }

  private async updateMarketplace(name: string): Promise<boolean> {
    const result = await this.runClaude(["plugin", "marketplace", "update", name], this.env);
    if (result.ok) {
      this.logger.info(`Updated marketplace '${pc.bold(name)}' via 'claude plugin marketplace update'.`);
      return true;
    }
    this.logger.warn(`Failed to update marketplace '${pc.bold(name)}' (${result.detail}).`);
    return false;
  }

  private async updatePlugin(pluginKey: string, scope: Scope): Promise<boolean> {
    const result = await this.runClaude(["plugin", "update", pluginKey, "--scope", scope, "-y"], this.env);
    if (result.ok) {
      this.logger.info(
        `Updated plugin '${pc.bold(pluginKey)}' via 'claude plugin update' (scope: ${scope}).`
      );
      return true;
    }
    this.logger.warn(
      `Failed to update plugin '${pc.bold(pluginKey)}' (${result.detail}) (scope: ${scope}).`
    );
    return false;
  }
}

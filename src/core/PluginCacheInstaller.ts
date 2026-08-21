import pc from "picocolors";
import { KnownMarketplacesCache } from "./KnownMarketplacesCache.js";
import { InstalledPluginsCache } from "./InstalledPluginsCache.js";
import { parsePluginKey } from "./pluginKey.js";
import { Scope } from "./types.js";
import { Logger } from "../util/Logger.js";
import { ClaudeRunner, defaultClaudeRunner } from "./ClaudeRunner.js";

/**
 * Ensures plugins enabled by this tool are actually materialized in Claude Code's own plugin
 * cache, by shelling out to `claude plugin install` — never by reimplementing its cache layout.
 * Best-effort: every failure path is a logged warning, never a thrown error, since the module/
 * settings write this runs alongside is the primary, reliable operation.
 */
export class PluginCacheInstaller {
  constructor(
    private readonly knownMarketplacesCache: KnownMarketplacesCache,
    private readonly installedPluginsCache: InstalledPluginsCache,
    private readonly logger: Logger,
    private readonly env: NodeJS.ProcessEnv,
    private readonly runClaude: ClaudeRunner = defaultClaudeRunner
  ) {}

  /**
   * `scope` defaults to `user` for the standalone `plugin install` command, which has no meaningful
   * target scope of its own (a module isn't tied to one at definition time) — but a caller that does
   * know the real target scope (`enable --install`/`reload --install`) must pass it, since
   * `claude plugin install` durably enables the plugin at whatever scope this runs with, not just
   * caches it. Returns the subset of `pluginKeys` this call actually installed (ok:true), so a caller
   * with no real scope of its own (see `neutralizeUserScopeEnablement`) knows which ones need undoing.
   */
  async ensureCached(pluginKeys: Iterable<string>, dryRun: boolean, scope: Scope = Scope.User): Promise<string[]> {
    const installed = await this.installedPluginsCache.keys();
    const freshlyInstalled: string[] = [];
    for (const pluginKey of pluginKeys) {
      if (installed.has(pluginKey)) {
        this.logger.debug(`'${pc.bold(pluginKey)}' already cached by Claude Code.`);
        continue;
      }
      if (dryRun) {
        this.logger.info(
          `${pc.dim("[dry-run]")} '${pc.bold(pluginKey)}' is not cached by Claude Code — would run 'claude plugin ` +
            `install ${pluginKey} --scope ${scope} -y'.`
        );
        continue;
      }
      if (await this.installOne(pluginKey, scope)) freshlyInstalled.push(pluginKey);
    }
    return freshlyInstalled;
  }

  /**
   * Undoes the enablement side effect of a user-scope-only cache-warming install: `claude plugin
   * install` enables the plugin at the scope it's given, and the standalone `plugin install` command
   * has no real target scope to give it, so it always caches at `user` — this neutralizes that
   * specific enablement right after, leaving the plugin materialized in the shared cache but not
   * live at the user's real global scope as an unrequested side effect. Best-effort, same as
   * `ensureCached`: a failure here is a logged warning, never a thrown error.
   */
  async neutralizeUserScopeEnablement(pluginKeys: readonly string[]): Promise<void> {
    for (const pluginKey of pluginKeys) {
      const result = await this.runClaude(["plugin", "disable", pluginKey, "--scope", Scope.User], this.env);
      if (!result.ok) {
        this.logger.warn(
          `Installed '${pc.bold(pluginKey)}' into Claude Code's cache, but could not disable it at user scope ` +
            `afterward (${result.detail}).\n  It's now enabled at your real user scope as a side effect of ` +
            `caching — run 'claude plugin disable ${pluginKey} --scope user' manually, or leave it if that's fine.`
        );
      }
    }
  }

  private async installOne(pluginKey: string, scope: Scope): Promise<boolean> {
    const { marketplace } = parsePluginKey(pluginKey);
    const known = await this.knownMarketplacesCache.get(marketplace);
    if (known === undefined) {
      this.logger.warn(
        `'${pc.bold(pluginKey)}' isn't cached by Claude Code, and marketplace '${pc.bold(marketplace)}' isn't in ` +
          `its known_marketplaces.json either.\n  Run 'claude plugin marketplace add' for it, then retry, or a ` +
          `new session in a repo using this module will fail with 'not cached'.`
      );
      return false;
    }

    const result = await this.runClaude(["plugin", "install", pluginKey, "--scope", scope, "-y"], this.env);
    if (result.ok) {
      this.logger.info(
        `Plugin '${pc.bold(pluginKey)}' was not cached by Claude Code yet — installed it now via ` +
          `'claude plugin install' (scope: ${scope}) so sessions in repos using this module won't fail at startup.`
      );
      return true;
    }
    this.logger.warn(
      `Failed to install '${pc.bold(pluginKey)}' into Claude Code's cache (${result.detail}).\n  It's enabled ` +
        `in the module/settings, but a new session may fail with 'not cached' until you run ` +
        `'claude plugin install ${pluginKey} --scope ${scope}' manually.`
    );
    return false;
  }
}

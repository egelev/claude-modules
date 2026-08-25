import pc from "picocolors";
import { Command } from "./Command.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { MarketplaceRegistry } from "../../core/MarketplaceRegistry.js";
import { KnownMarketplacesCache } from "../../core/KnownMarketplacesCache.js";
import { MarketplaceCacheInstaller } from "../../core/MarketplaceCacheInstaller.js";
import { PluginCacheInstaller } from "../../core/PluginCacheInstaller.js";
import { parsePluginKey } from "../../core/pluginKey.js";
import { bumpPatch } from "../../core/semver.js";
import { warnIfNonPortableMarketplace } from "../../core/marketplacePortability.js";
import { InvalidJsonError, UnknownMarketplaceError } from "../../util/errors.js";
import { Logger } from "../../util/Logger.js";

export class InstallCommand implements Command {
  constructor(
    private readonly pluginKey: string,
    private readonly moduleName: string,
    private readonly sourceJson: string | undefined,
    private readonly moduleStore: ModuleStore,
    private readonly marketplaceRegistry: MarketplaceRegistry,
    private readonly knownMarketplacesCache: KnownMarketplacesCache,
    private readonly marketplaceCacheInstaller: MarketplaceCacheInstaller,
    private readonly pluginCacheInstaller: PluginCacheInstaller,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const { full, marketplace } = parsePluginKey(this.pluginKey);
    const module = await this.moduleStore.load(this.moduleName);

    // --source is handled before the already-enabled check below: it signals explicit intent to
    // (re-)establish this marketplace with Claude Code, which must not be silently dropped just
    // because the plugin itself was already marked enabled by an earlier, only-partially-successful
    // install (e.g. one that hit the "not cached" warning this call is meant to repair).
    let explicitSource: unknown;
    if (this.sourceJson !== undefined) {
      try {
        explicitSource = JSON.parse(this.sourceJson);
      } catch (err) {
        throw new InvalidJsonError("--source", err);
      }
      await this.marketplaceCacheInstaller.ensureCached({ [marketplace]: explicitSource }, this.dryRun);
    }

    if (module.enabledPlugins[full] === true) {
      this.logger.warn(`'${pc.bold(full)}' is already enabled in module '${pc.bold(this.moduleName)}'; nothing to do.`);
      return;
    }

    if (explicitSource !== undefined) {
      module.extraKnownMarketplaces[marketplace] = explicitSource;
      this.logger.debug(
        `Recorded explicit --source for marketplace '${pc.bold(marketplace)}' on module '${pc.bold(this.moduleName)}'.`
      );
    } else if (!(marketplace in module.extraKnownMarketplaces)) {
      const registered = await this.marketplaceRegistry.get(marketplace);
      if (registered !== undefined) {
        module.extraKnownMarketplaces[marketplace] = registered;
        this.logger.debug(`Resolved marketplace '${pc.bold(marketplace)}' from the global registry.`);
      } else {
        const cached = await this.knownMarketplacesCache.get(marketplace);
        if (cached === undefined) {
          throw new UnknownMarketplaceError(marketplace);
        }
        module.extraKnownMarketplaces[marketplace] = cached;
        this.logger.debug(
          `Resolved marketplace '${pc.bold(marketplace)}' from Claude Code's local known_marketplaces.json ` +
            `(run 'marketplace add' to make this resolution explicit and stable).`
        );
        warnIfNonPortableMarketplace(this.logger, marketplace, cached);
      }
    }

    module.enabledPlugins[full] = true;
    module.version = bumpPatch(module.version);

    this.logger.section();
    if (this.dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would install '${pc.bold(full)}' into module '${pc.bold(this.moduleName)}'.`);
    } else {
      await this.moduleStore.save(this.moduleName, module);
      this.logger.info(`Installed '${pc.bold(full)}' into module '${pc.bold(this.moduleName)}'.`);
    }

    this.logger.section();
    // No scope is threaded through here — a module isn't tied to one at definition time, so caching
    // always targets 'user' (PluginCacheInstaller's default). That durably enables the plugin at the
    // user's real global scope as a side effect of caching it, which this command has no scope of its
    // own to justify — so immediately neutralize it, leaving the plugin materialized in the shared
    // cache without silently going live everywhere. `enable --install`/`reload --install` pass their
    // real target scope instead (see ApplyModulesUseCase), so the side effect lands where their own
    // write is about to land anyway and this neutralize step is unique to this standalone command.
    const freshlyInstalled = await this.pluginCacheInstaller.ensureCached([full], this.dryRun);
    if (freshlyInstalled.length > 0) {
      await this.pluginCacheInstaller.neutralizeUserScopeEnablement(freshlyInstalled);
    }
  }
}

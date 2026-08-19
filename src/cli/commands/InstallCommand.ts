import pc from "picocolors";
import { Command } from "./Command.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { MarketplaceRegistry } from "../../core/MarketplaceRegistry.js";
import { KnownMarketplacesCache } from "../../core/KnownMarketplacesCache.js";
import { PluginCacheInstaller } from "../../core/PluginCacheInstaller.js";
import { parsePluginKey } from "../../core/pluginKey.js";
import { warnIfNonPortableMarketplace } from "../../core/marketplacePortability.js";
import { UnknownMarketplaceError } from "../../util/errors.js";
import { Logger } from "../../util/Logger.js";

export class InstallCommand implements Command {
  constructor(
    private readonly pluginKey: string,
    private readonly moduleName: string,
    private readonly sourceJson: string | undefined,
    private readonly moduleStore: ModuleStore,
    private readonly marketplaceRegistry: MarketplaceRegistry,
    private readonly knownMarketplacesCache: KnownMarketplacesCache,
    private readonly pluginCacheInstaller: PluginCacheInstaller,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const { full, marketplace } = parsePluginKey(this.pluginKey);
    const module = await this.moduleStore.load(this.moduleName);

    if (this.sourceJson !== undefined) {
      module.extraKnownMarketplaces[marketplace] = JSON.parse(this.sourceJson);
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

    this.logger.section();
    if (this.dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would install '${pc.bold(full)}' into module '${pc.bold(this.moduleName)}'.`);
    } else {
      await this.moduleStore.save(this.moduleName, module);
      this.logger.info(`Installed '${pc.bold(full)}' into module '${pc.bold(this.moduleName)}'.`);
    }

    this.logger.section();
    await this.pluginCacheInstaller.ensureCached([full], this.dryRun);
  }
}

import pc from "picocolors";
import { Command } from "./Command.js";
import { ProfileStore } from "../../core/ProfileStore.js";
import { MarketplaceRegistry } from "../../core/MarketplaceRegistry.js";
import { KnownMarketplacesCache } from "../../core/KnownMarketplacesCache.js";
import { PluginCacheInstaller } from "../../core/PluginCacheInstaller.js";
import { parsePluginKey } from "../../core/pluginKey.js";
import { UnknownMarketplaceError } from "../../util/errors.js";
import { Logger } from "../../util/Logger.js";

export class InstallCommand implements Command {
  constructor(
    private readonly pluginKey: string,
    private readonly profileName: string,
    private readonly sourceJson: string | undefined,
    private readonly profileStore: ProfileStore,
    private readonly marketplaceRegistry: MarketplaceRegistry,
    private readonly knownMarketplacesCache: KnownMarketplacesCache,
    private readonly pluginCacheInstaller: PluginCacheInstaller,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const { full, marketplace } = parsePluginKey(this.pluginKey);
    const profile = await this.profileStore.load(this.profileName);

    if (this.sourceJson !== undefined) {
      profile.extraKnownMarketplaces[marketplace] = JSON.parse(this.sourceJson);
      this.logger.debug(
        `Recorded explicit --source for marketplace '${pc.bold(marketplace)}' on profile '${pc.bold(this.profileName)}'.`
      );
    } else if (!(marketplace in profile.extraKnownMarketplaces)) {
      const registered = await this.marketplaceRegistry.get(marketplace);
      if (registered !== undefined) {
        profile.extraKnownMarketplaces[marketplace] = registered;
        this.logger.debug(`Resolved marketplace '${pc.bold(marketplace)}' from the global registry.`);
      } else {
        const cached = await this.knownMarketplacesCache.get(marketplace);
        if (cached === undefined) {
          throw new UnknownMarketplaceError(marketplace);
        }
        profile.extraKnownMarketplaces[marketplace] = cached;
        this.logger.debug(
          `Resolved marketplace '${pc.bold(marketplace)}' from Claude Code's local known_marketplaces.json ` +
            `(run 'add-marketplace' to make this resolution explicit and stable).`
        );
        this.warnIfNonPortable(marketplace, cached);
      }
    }

    profile.enabledPlugins[full] = true;

    this.logger.section();
    if (this.dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would install '${pc.bold(full)}' into profile '${pc.bold(this.profileName)}'.`);
    } else {
      await this.profileStore.save(this.profileName, profile);
      this.logger.info(`Installed '${pc.bold(full)}' into profile '${pc.bold(this.profileName)}'.`);
    }

    this.logger.section();
    await this.pluginCacheInstaller.ensureCached([full], this.dryRun);
  }

  // MarketplaceSource is opaque everywhere else; this narrow, isolated peek exists only to
  // warn when a marketplace pulled from Claude Code's local cache won't travel to another machine.
  private warnIfNonPortable(marketplace: string, source: unknown): void {
    const inner = source as { source?: { source?: string } };
    const kind = inner.source?.source;
    if (kind !== undefined && kind !== "github") {
      this.logger.warn(
        `Marketplace '${pc.bold(marketplace)}' was resolved from a '${kind}' source.\n  ` +
          `This is machine-specific and won't travel with this profile to another machine.`
      );
    }
  }
}

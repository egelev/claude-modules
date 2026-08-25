import pc from "picocolors";
import { Command } from "./Command.js";
import { MarketplaceRegistry } from "../../core/MarketplaceRegistry.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { MarketplaceCacheInstaller } from "../../core/MarketplaceCacheInstaller.js";
import { classifyMarketplaceSource, parseMarketplaceSpec } from "../../core/marketplaceSpec.js";
import { bumpPatch } from "../../core/semver.js";
import { Logger } from "../../util/Logger.js";
import { CliError, describeError, InvalidJsonError } from "../../util/errors.js";
import { describeMarketplaceTarget } from "./marketplaceTarget.js";

export class AddMarketplaceCommand implements Command {
  constructor(
    private readonly spec: string,
    private readonly nameOverride: string | undefined,
    private readonly sourceJson: string | undefined,
    private readonly moduleName: string | undefined,
    private readonly marketplaceRegistry: MarketplaceRegistry,
    private readonly moduleStore: ModuleStore,
    private readonly marketplaceCacheInstaller: MarketplaceCacheInstaller,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const target = describeMarketplaceTarget(this.moduleName);

    if (this.sourceJson !== undefined) {
      const name = this.nameOverride ?? this.inferName(this.spec);
      let source: unknown;
      try {
        source = JSON.parse(this.sourceJson);
      } catch (err) {
        throw new InvalidJsonError("--source", err);
      }
      if (this.dryRun) {
        this.logger.info(`${pc.dim("[dry-run]")} Would register marketplace '${pc.bold(name)}' with an explicit --source in ${target}.`);
      } else {
        await this.register(name, source);
        this.logger.info(`Registered marketplace '${pc.bold(name)}' with an explicit --source in ${target}.`);
      }
      await this.marketplaceCacheInstaller.ensureCached({ [name]: source }, this.dryRun);
      return;
    }

    let name: string;
    let source: unknown;
    try {
      const parsed = parseMarketplaceSpec(this.spec);
      name = this.nameOverride ?? parsed.inferredName;
      source = parsed.source;
    } catch (err) {
      throw new CliError(
        `Could not infer a marketplace source from '${this.spec}'. Use --source '<json>' to specify it explicitly. (${describeError(err)})`
      );
    }

    if (this.dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would register marketplace '${pc.bold(name)}' from '${pc.bold(this.spec)}' in ${target}.`);
    } else {
      await this.register(name, source);
      this.logger.info(`Registered marketplace '${pc.bold(name)}' from '${pc.bold(this.spec)}' in ${target}.`);
    }
    await this.marketplaceCacheInstaller.ensureCached({ [name]: source }, this.dryRun);
    if (classifyMarketplaceSource(source) !== "github") {
      this.logger.section();
      this.logger.warn(
        "The settings.json shape for non-GitHub marketplace sources is unverified against real Claude Code output.\n  " +
          "Double-check the registered entry, or re-run with --source '<json>' if it's wrong."
      );
    }
  }

  /** Best-effort name inference, shared by the --source and non---source paths — falls back to the
   * raw spec (matching the pre-inference behavior) if `spec` isn't a shape parseMarketplaceSpec can
   * infer a name from (e.g. GitHub shorthand with a '#ref' fragment). */
  private inferName(spec: string): string {
    try {
      return parseMarketplaceSpec(spec).inferredName;
    } catch {
      return spec;
    }
  }

  private async register(name: string, source: unknown): Promise<void> {
    if (this.moduleName === undefined) {
      await this.marketplaceRegistry.set(name, source);
      return;
    }
    const module = await this.moduleStore.load(this.moduleName);
    module.extraKnownMarketplaces[name] = source;
    await this.moduleStore.saveWithBump(this.moduleName, module, bumpPatch);
  }
}

import pc from "picocolors";
import { Command } from "./Command.js";
import { MarketplaceRegistry } from "../../core/MarketplaceRegistry.js";
import { parseMarketplaceSpec } from "../../core/marketplaceSpec.js";
import { Logger } from "../../util/Logger.js";
import { CliError } from "../../util/errors.js";

export class AddMarketplaceCommand implements Command {
  constructor(
    private readonly spec: string,
    private readonly nameOverride: string | undefined,
    private readonly sourceJson: string | undefined,
    private readonly marketplaceRegistry: MarketplaceRegistry,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    if (this.sourceJson !== undefined) {
      const name = this.nameOverride ?? this.spec;
      const source = JSON.parse(this.sourceJson);
      if (this.dryRun) {
        this.logger.info(`${pc.dim("[dry-run]")} Would register marketplace '${pc.bold(name)}' with an explicit --source.`);
      } else {
        await this.marketplaceRegistry.set(name, source);
        this.logger.info(`Registered marketplace '${pc.bold(name)}' with an explicit --source.`);
      }
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
        `Could not infer a marketplace source from '${this.spec}'. Use --source '<json>' to specify it explicitly. (${
          err instanceof Error ? err.message : String(err)
        })`
      );
    }

    if (this.dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would register marketplace '${pc.bold(name)}' from '${pc.bold(this.spec)}'.`);
    } else {
      await this.marketplaceRegistry.set(name, source);
      this.logger.info(`Registered marketplace '${pc.bold(name)}' from '${pc.bold(this.spec)}'.`);
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(this.spec)) {
      this.logger.section();
      this.logger.warn(
        "The settings.json shape for non-GitHub marketplace sources is unverified against real Claude Code output.\n  " +
          "Double-check the registered entry, or re-run with --source '<json>' if it's wrong."
      );
    }
  }
}

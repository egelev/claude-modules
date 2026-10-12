import pc from "picocolors";
import { dryRunTag } from "../../util/outputStyle.js";
import { Command } from "./Command.js";
import { MarketplaceRegistry } from "../../core/MarketplaceRegistry.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { MarketplaceCacheInstaller } from "../../core/MarketplaceCacheInstaller.js";
import { classifyMarketplaceSource, parseMarketplaceSpec } from "../../core/marketplaceSpec.js";
import { bumpPatch } from "../../core/semver.js";
import { Logger } from "../../util/Logger.js";
import { isDirectory, isFile } from "../../util/fsProbe.js";
import { CliError, describeError, InvalidJsonError } from "../../util/errors.js";
import { describeMarketplaceTarget } from "./marketplaceTarget.js";

export class AddMarketplaceCommand implements Command {
  constructor(
    private readonly spec: string,
    private readonly nameOverride: string | undefined,
    private readonly sourceJson: string | undefined,
    private readonly moduleName: string | undefined,
    private readonly cwd: string,
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
        this.logger.info(`${dryRunTag()} Would register marketplace '${pc.bold(name)}' with an explicit --source in ${target}.`);
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
      const parsed = parseMarketplaceSpec(this.spec, { cwd: this.cwd });
      name = this.nameOverride ?? parsed.inferredName;
      source = parsed.source;
    } catch (err) {
      throw new CliError(
        `Could not infer a marketplace source from '${this.spec}'. Use --source '<json>' to specify it explicitly. (${describeError(err)})`
      );
    }
    source = await this.checkLocalPath(source);

    if (this.dryRun) {
      this.logger.info(`${dryRunTag()} Would register marketplace '${pc.bold(name)}' from '${pc.bold(this.spec)}' in ${target}.`);
    } else {
      await this.register(name, source);
      this.logger.info(`Registered marketplace '${pc.bold(name)}' from '${pc.bold(this.spec)}' in ${target}.`);
    }
    await this.marketplaceCacheInstaller.ensureCached({ [name]: source }, this.dryRun);
  }

  /**
   * Mirrors the checks Claude Code's own `marketplace add` makes on a path spec. An existing path is
   * typed by what it is — a directory, or a `.json` file (any other file is refused) — instead of by
   * its extension alone. A missing path is only a warning: the module write is still worth keeping,
   * e.g. for a path that's created later.
   */
  private async checkLocalPath(source: unknown): Promise<unknown> {
    const kind = classifyMarketplaceSource(source);
    if (kind !== "directory" && kind !== "file") return source;
    const path = (source as { source: { path: string } }).source.path;
    if (await isDirectory(path)) return { source: { source: "directory", path } };
    if (await isFile(path)) {
      if (!path.endsWith(".json")) {
        throw new CliError(`File path must point to a .json file (marketplace.json), but got: ${path}`);
      }
      return { source: { source: "file", path } };
    }
    this.logger.warn(`Path does not exist: ${pc.bold(path)}.\n  Claude Code can't load this marketplace until it does.`);
    return source;
  }

  /** Best-effort name inference, shared by the --source and non---source paths — falls back to the
   * raw spec (matching the pre-inference behavior) if `spec` isn't a shape parseMarketplaceSpec can
   * infer a name from (e.g. GitHub shorthand with an empty trailing '@' ref). */
  private inferName(spec: string): string {
    try {
      return parseMarketplaceSpec(spec, { cwd: this.cwd }).inferredName;
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

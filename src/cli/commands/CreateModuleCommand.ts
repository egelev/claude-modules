import pc from "picocolors";
import { Command } from "./Command.js";
import { CompositionResolver } from "../../core/CompositionResolver.js";
import { ModuleStore } from "../../core/ModuleStore.js";
import { ScopeResolver } from "../../core/ScopeResolver.js";
import { SettingsRepository } from "../../core/SettingsRepository.js";
import { emptyModule, Module, Scope } from "../../core/types.js";
import { warnIfNonPortableMarketplace } from "../../core/marketplacePortability.js";
import { Logger } from "../../util/Logger.js";
import { ModuleExistsError } from "../../util/errors.js";

/**
 * Creates a module, either empty or seeded from a scope's live settings.json (`--from-scope`).
 * The seeding path exists because the shapes already match — a module is
 * `{enabledPlugins, extraKnownMarketplaces}`, the same two keys this tool writes into settings.json
 * — so capturing a working setup is a copy, not a translation.
 */
export class CreateModuleCommand implements Command {
  constructor(
    private readonly name: string,
    private readonly moduleStore: ModuleStore,
    private readonly logger: Logger,
    private readonly dryRun: boolean,
    /** Seed the new module from this scope's settings.json instead of creating it empty. */
    private readonly fromScope: Scope | undefined,
    private readonly cwd: string,
    private readonly scopeResolver: ScopeResolver,
    private readonly settingsRepository: SettingsRepository,
    private readonly compositionResolver: CompositionResolver,
    /** Module names this module composes, from repeatable --compose. Sets the initial composition
     * only — ComposeAddCommand/ComposeRemoveCommand change it later, no hand-editing required. */
    private readonly composeOf: readonly string[]
  ) {}

  async execute(): Promise<void> {
    if (await this.moduleStore.exists(this.name)) {
      throw new ModuleExistsError(this.name);
    }

    const { module, origin } = await this.buildModule();

    if (this.composeOf.length > 0) {
      module.composedModules = [...this.composeOf];
      // Validates cycles, missing references, and sibling marketplace conflicts before anything is
      // written — the override map lets the resolver see this not-yet-saved module in the graph.
      await this.compositionResolver.resolveEffective(this.name, new Map([[this.name, module]]));
    }

    const pluginCount = Object.keys(module.enabledPlugins).length;
    const marketplaceCount = Object.keys(module.extraKnownMarketplaces).length;
    const composedCount = module.composedModules.length;

    if (this.dryRun) {
      this.logger.info(
        `${pc.dim("[dry-run]")} Would create module '${pc.bold(this.name)}'${origin} with ` +
          `${pluginCount} plugin(s), ${marketplaceCount} marketplace(s), and ${composedCount} composed module(s).`
      );
      return;
    }

    await this.moduleStore.save(this.name, module);
    this.logger.info(
      `Created module '${pc.bold(this.name)}'${origin} with ${pluginCount} plugin(s), ` +
        `${marketplaceCount} marketplace(s), and ${composedCount} composed module(s).`
    );

    if (this.fromScope !== undefined && pluginCount === 0) {
      this.logger.warn(
        `No plugins were enabled in ${this.fromScope} scope, so '${pc.bold(this.name)}' is empty. ` +
          `Add plugins with 'claude-modules plugin install ${this.name} <plugin>@<marketplace>'.`
      );
    }
  }

  private async buildModule(): Promise<{ module: Module; origin: string }> {
    if (this.fromScope === undefined) {
      return { module: emptyModule(), origin: "" };
    }

    const resolved = await this.scopeResolver.resolve(this.fromScope, this.cwd);
    const settings = await this.settingsRepository.read(resolved.settingsPath);

    // Only genuinely-enabled plugins are captured. An explicit `false` in settings.json is an
    // override (that's how `enable --only` suppresses a broader scope's plugin), not a member of
    // the set this scope uses — copying it would turn a local override into a module-wide one.
    const enabledPlugins = Object.fromEntries(
      Object.entries(settings.enabledPlugins ?? {})
        .filter(([, enabled]) => enabled)
        .map(([pluginKey]) => [pluginKey, true])
    );

    const extraKnownMarketplaces = { ...(settings.extraKnownMarketplaces ?? {}) };
    // Same warning `plugin install` gives: this path is the likeliest to pick up a local-path marketplace,
    // since it copies whatever '/plugin marketplace add ./somewhere' left in settings.json.
    for (const [marketplace, source] of Object.entries(extraKnownMarketplaces)) {
      warnIfNonPortableMarketplace(this.logger, marketplace, source);
    }

    return {
      module: { version: "1.0.0", enabledPlugins, extraKnownMarketplaces, composedModules: [] },
      origin: ` from ${this.fromScope} scope (${pc.bold(resolved.settingsPath)})`,
    };
  }
}

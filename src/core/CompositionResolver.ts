import { ModuleStore } from "./ModuleStore.js";
import { unionEffectiveModules } from "./moduleUnion.js";
import { EffectiveModule, Module } from "./types.js";
import { CompositionCycleError } from "../util/errors.js";

/**
 * Flattens a module's `composedModules` chain into its effective plugins/marketplaces: composed
 * siblings are unioned together (conflict-detected, same as `enable a b` today), then the module's
 * own `enabledPlugins`/`extraKnownMarketplaces` are spread on top so they win over anything a
 * composed module also declares.
 */
export class CompositionResolver {
  constructor(private readonly moduleStore: ModuleStore) {}

  /** Full flatten: plugins and marketplaces, failing on a sibling marketplace conflict. */
  async resolveEffective(name: string, overrides?: ReadonlyMap<string, Module>): Promise<EffectiveModule> {
    return this.resolveEffectiveAt(name, overrides, []);
  }

  /** Plugin-only flatten — never touches or fails on marketplace conflicts. Used by the disable path. */
  async resolveEffectivePluginNames(name: string, overrides?: ReadonlyMap<string, Module>): Promise<Set<string>> {
    return this.resolvePluginNamesAt(name, overrides, []);
  }

  private async loadModule(name: string, overrides: ReadonlyMap<string, Module> | undefined): Promise<Module> {
    return overrides?.get(name) ?? this.moduleStore.load(name);
  }

  private async resolveEffectiveAt(
    name: string,
    overrides: ReadonlyMap<string, Module> | undefined,
    path: readonly string[]
  ): Promise<EffectiveModule> {
    if (path.includes(name)) throw new CompositionCycleError([...path, name]);
    const module = await this.loadModule(name, overrides);
    const nextPath = [...path, name];

    const childEntries = await Promise.all(
      module.composedModules.map(async (childName) => ({
        name: childName,
        module: await this.resolveEffectiveAt(childName, overrides, nextPath),
      }))
    );
    const composed = unionEffectiveModules(childEntries);
    const composedEnabledPlugins = Object.fromEntries([...composed.enabledPluginNames].map((key) => [key, true]));

    return {
      enabledPlugins: { ...composedEnabledPlugins, ...module.enabledPlugins },
      extraKnownMarketplaces: { ...composed.extraKnownMarketplaces, ...module.extraKnownMarketplaces },
    };
  }

  private async resolvePluginNamesAt(
    name: string,
    overrides: ReadonlyMap<string, Module> | undefined,
    path: readonly string[]
  ): Promise<Set<string>> {
    if (path.includes(name)) throw new CompositionCycleError([...path, name]);
    const module = await this.loadModule(name, overrides);
    const nextPath = [...path, name];

    const childSets = await Promise.all(
      module.composedModules.map((childName) => this.resolvePluginNamesAt(childName, overrides, nextPath))
    );
    const composedEnabledPlugins: Record<string, boolean> = {};
    for (const childSet of childSets) {
      for (const pluginKey of childSet) composedEnabledPlugins[pluginKey] = true;
    }

    const merged = { ...composedEnabledPlugins, ...module.enabledPlugins };
    return new Set(Object.entries(merged).filter(([, enabled]) => enabled).map(([pluginKey]) => pluginKey));
  }
}

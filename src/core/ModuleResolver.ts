import pc from "picocolors";
import { CompositionResolver } from "./CompositionResolver.js";
import { ResolvedModules, unionEffectiveModules } from "./moduleUnion.js";
import { Logger } from "../util/Logger.js";

export type { ResolvedModules } from "./moduleUnion.js";

/** Loads a set of named (composition-resolved) modules and computes their union: enabled plugins and known marketplaces. */
export class ModuleResolver {
  constructor(
    private readonly compositionResolver: CompositionResolver,
    private readonly logger: Logger
  ) {}

  async resolve(moduleNames: readonly string[]): Promise<ResolvedModules> {
    const entries = await Promise.all(
      moduleNames.map(async (name) => ({ name, module: await this.compositionResolver.resolveEffective(name) }))
    );
    const resolved = unionEffectiveModules(entries);

    if (resolved.enabledPluginNames.size === 0) {
      this.logger.warn(
        `Selected module(s) [${pc.bold(moduleNames.join(", "))}] enable no plugins — every plugin in the target scope will be disabled.`
      );
    }

    return resolved;
  }

  /**
   * Like `resolve`, but only unions enabled plugin names — no marketplace-conflict checking. Used
   * by `disable`, which never touches marketplaces and shouldn't fail on a conflict that's
   * irrelevant to it.
   */
  async resolveEnabledPluginNames(moduleNames: readonly string[]): Promise<Set<string>> {
    const enabledPluginNames = new Set<string>();

    for (const moduleName of moduleNames) {
      const names = await this.compositionResolver.resolveEffectivePluginNames(moduleName);
      for (const name of names) enabledPluginNames.add(name);
    }

    if (enabledPluginNames.size === 0) {
      this.logger.warn(`Selected module(s) [${pc.bold(moduleNames.join(", "))}] enable no plugins — nothing to disable.`);
    }

    return enabledPluginNames;
  }
}

import { InvalidModuleShapeError } from "../util/errors.js";

export enum Scope {
  User = "user",
  Project = "project",
  Local = "local",
}

export const SCOPES: readonly Scope[] = [Scope.User, Scope.Project, Scope.Local];

/** Scopes less specific than `scope`, ordered from most to least specific. Local > Project > User. */
export function lessSpecificScopes(scope: Scope): Scope[] {
  switch (scope) {
    case Scope.Local:
      return [Scope.Project, Scope.User];
    case Scope.Project:
      return [Scope.User];
    case Scope.User:
      return [];
  }
}

/**
 * Every scope actually in effect at a location, most specific first — Claude Code's own model.
 * `local` resolves against the current directory whether or not it's a repository (Claude Code
 * itself watches `<cwd>/.claude/settings.local.json` unconditionally); `project` is meant to be
 * shared via a repository, so it's absent outside one.
 *
 * Distinct from `lessSpecificScopes`, and the two are not interchangeable: this is "what decides
 * whether a plugin loads here" (always the whole chain), whereas `lessSpecificScopes` answers
 * "what can a write to *this* scope's file override" — see `enable --only`.
 */
export function applicableScopes(inRepo: boolean): Scope[] {
  return inRepo ? [Scope.Local, Scope.Project, Scope.User] : [Scope.Local, Scope.User];
}

/** Opaque marketplace source descriptor — stored and compared verbatim, never interpreted. */
export type MarketplaceSource = unknown;

export interface Module {
  version: string;
  enabledPlugins: Record<string, boolean>;
  extraKnownMarketplaces: Record<string, MarketplaceSource>;
  composedModules: string[];
}

/** The flattened result of resolving a module's composition — never itself re-savable or re-resolvable. */
export type EffectiveModule = Pick<Module, "enabledPlugins" | "extraKnownMarketplaces">;

/** A Claude Code settings.json. Only enabledPlugins/extraKnownMarketplaces are understood; everything else passes through untouched. */
export interface ClaudeSettings {
  enabledPlugins?: Record<string, boolean>;
  extraKnownMarketplaces?: Record<string, MarketplaceSource>;
  [key: string]: unknown;
}

export interface MarketplaceRegistryFile {
  marketplaces: Record<string, MarketplaceSource>;
  [key: string]: unknown;
}

/** Claude Code's own cache of resolved marketplaces (~/.claude/plugins/known_marketplaces.json). */
export interface KnownMarketplacesFile {
  [name: string]: {
    source: MarketplaceSource;
    // Machine-specific materialized state — deliberately never copied onto a module.
    installLocation?: string;
    lastUpdated?: string;
  };
}

/** Claude Code's own registry of materialized/cached plugins (~/.claude/plugins/installed_plugins.json). */
export interface InstalledPluginsFile {
  version?: number;
  // Keys are "<plugin>@<marketplace>"; values are per-install-scope entries we never need to interpret.
  plugins: Record<string, unknown[]>;
  [key: string]: unknown;
}

export function emptyModule(): Module {
  return { version: "1.0.0", enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] };
}

/**
 * Fills in defaults for a Module parsed from disk — the single place that knows what's missing
 * means. `moduleName`, when known to the caller, is included in a shape-error message only — it
 * plays no role in normalization itself.
 */
export function normalizeModule(parsed: Partial<Module>, moduleName?: string): Module {
  if (parsed.composedModules !== undefined) {
    // A hand-edited settings.json is the only way composedModules can be a shape other than
    // string[] — 'compose add'/'compose remove' and 'create --compose' only ever write an array of
    // strings. Left unchecked, a string here (JSON allows `"composedModules": "base"`) is silently
    // accepted and produces bizarre downstream behavior instead of a clean error: `.includes` on a
    // string matches substrings, and spreading it spreads individual characters as "module names".
    const isStringArray =
      Array.isArray(parsed.composedModules) && parsed.composedModules.every((entry) => typeof entry === "string");
    if (!isStringArray) {
      throw new InvalidModuleShapeError("composedModules", "an array of strings", moduleName);
    }
  }
  return {
    version: parsed.version ?? "1.0.0",
    enabledPlugins: parsed.enabledPlugins ?? {},
    extraKnownMarketplaces: parsed.extraKnownMarketplaces ?? {},
    composedModules: parsed.composedModules ?? [],
  };
}

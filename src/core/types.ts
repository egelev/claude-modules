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

/** Opaque marketplace source descriptor — stored and compared verbatim, never interpreted. */
export type MarketplaceSource = unknown;

export interface Profile {
  enabledPlugins: Record<string, boolean>;
  extraKnownMarketplaces: Record<string, MarketplaceSource>;
}

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
    // Machine-specific materialized state — deliberately never copied onto a profile.
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

export function emptyProfile(): Profile {
  return { enabledPlugins: {}, extraKnownMarketplaces: {} };
}

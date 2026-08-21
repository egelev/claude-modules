import { Paths } from "../util/Paths.js";
import { readOptionalJsonFile } from "../util/jsonFile.js";
import { KnownMarketplacesFile, MarketplaceSource } from "./types.js";

/** Reads Claude Code's own marketplace cache (~/.claude/plugins/known_marketplaces.json), read-only. */
export class KnownMarketplacesCache {
  constructor(private readonly paths: Paths) {}

  async get(name: string): Promise<MarketplaceSource | undefined> {
    const file = await this.readFile();
    const entry = file[name];
    // known_marketplaces.json entries are { source: <descriptor>, installLocation, lastUpdated };
    // a module's extraKnownMarketplaces entries are { source: <descriptor> } — re-wrap, don't copy verbatim.
    return entry === undefined ? undefined : { source: entry.source };
  }

  private async readFile(): Promise<KnownMarketplacesFile> {
    return readOptionalJsonFile<KnownMarketplacesFile>(
      this.paths.knownMarketplacesFile,
      () => ({}),
      `Claude Code's known_marketplaces.json (${this.paths.knownMarketplacesFile})`
    );
  }
}

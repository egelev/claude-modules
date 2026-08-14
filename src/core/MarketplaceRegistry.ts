import { readFile } from "node:fs/promises";
import { Paths } from "../util/Paths.js";
import { atomicWriteFile, toJsonWithTrailingNewline } from "../util/atomicWrite.js";
import { MarketplaceNotFoundError } from "../util/errors.js";
import { MarketplaceRegistryFile, MarketplaceSource } from "./types.js";

/** The global marketplace registry kept in $CLAUDE_PROFILES_HOME/settings.json, populated by `add-marketplace`. */
export class MarketplaceRegistry {
  constructor(private readonly paths: Paths) {}

  async get(name: string): Promise<MarketplaceSource | undefined> {
    const file = await this.readFile();
    return file.marketplaces[name];
  }

  async set(name: string, source: MarketplaceSource): Promise<void> {
    const file = await this.readFile();
    file.marketplaces[name] = source;
    await atomicWriteFile(this.paths.globalSettingsFile, toJsonWithTrailingNewline(file));
  }

  async remove(name: string): Promise<void> {
    const file = await this.readFile();
    if (!(name in file.marketplaces)) {
      throw new MarketplaceNotFoundError(name);
    }
    delete file.marketplaces[name];
    await atomicWriteFile(this.paths.globalSettingsFile, toJsonWithTrailingNewline(file));
  }

  private async readFile(): Promise<MarketplaceRegistryFile> {
    const raw = await readFile(this.paths.globalSettingsFile, "utf8").catch((err) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (raw === null) return { marketplaces: {} };
    const parsed = JSON.parse(raw) as Partial<MarketplaceRegistryFile>;
    return { ...parsed, marketplaces: parsed.marketplaces ?? {} };
  }
}

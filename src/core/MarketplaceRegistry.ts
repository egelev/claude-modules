import { Paths } from "../util/Paths.js";
import { atomicWriteFile, toJsonWithTrailingNewline } from "../util/atomicWrite.js";
import { MarketplaceNotFoundError } from "../util/errors.js";
import { readOptionalJsonFile } from "../util/jsonFile.js";
import { MarketplaceRegistryFile, MarketplaceSource } from "./types.js";

/** The global marketplace registry kept in $CLAUDE_MODULES_HOME/settings.json, populated by `marketplace add`. */
export class MarketplaceRegistry {
  constructor(private readonly paths: Paths) {}

  async get(name: string): Promise<MarketplaceSource | undefined> {
    const file = await this.readFile();
    return file.marketplaces[name];
  }

  async list(): Promise<Record<string, MarketplaceSource>> {
    const file = await this.readFile();
    return file.marketplaces;
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
    const parsed = await readOptionalJsonFile<Partial<MarketplaceRegistryFile>>(
      this.paths.globalSettingsFile,
      () => ({}),
      `Marketplace registry (${this.paths.globalSettingsFile})`
    );
    return { ...parsed, marketplaces: parsed.marketplaces ?? {} };
  }
}

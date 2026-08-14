import { readdir, readFile, unlink } from "node:fs/promises";
import { Paths } from "../util/Paths.js";
import { atomicWriteFile, toJsonWithTrailingNewline } from "../util/atomicWrite.js";
import { ProfileExistsError, ProfileNotFoundError } from "../util/errors.js";
import { emptyProfile, Profile } from "./types.js";
import { validateProfileName } from "./profileName.js";

/** CRUD over the JSON profile files under $CLAUDE_PROFILES_HOME/profiles. */
export class ProfileStore {
  constructor(private readonly paths: Paths) {}

  async list(): Promise<string[]> {
    const entries = await readdir(this.paths.profilesDir, { withFileTypes: true }).catch((err) => {
      if (err.code === "ENOENT") return [];
      throw err;
    });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -".json".length))
      .sort();
  }

  async exists(name: string): Promise<boolean> {
    validateProfileName(name);
    return readFile(this.paths.profileFile(name), "utf8")
      .then(() => true)
      .catch(() => false);
  }

  async load(name: string): Promise<Profile> {
    validateProfileName(name);
    const raw = await readFile(this.paths.profileFile(name), "utf8").catch((err) => {
      if (err.code === "ENOENT") throw new ProfileNotFoundError(name);
      throw err;
    });
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return {
      enabledPlugins: parsed.enabledPlugins ?? {},
      extraKnownMarketplaces: parsed.extraKnownMarketplaces ?? {},
    };
  }

  async create(name: string): Promise<void> {
    validateProfileName(name);
    if (await this.exists(name)) {
      throw new ProfileExistsError(name);
    }
    await this.save(name, emptyProfile());
  }

  async save(name: string, profile: Profile): Promise<void> {
    validateProfileName(name);
    await atomicWriteFile(this.paths.profileFile(name), toJsonWithTrailingNewline(profile));
  }

  async remove(name: string): Promise<void> {
    validateProfileName(name);
    await unlink(this.paths.profileFile(name)).catch((err) => {
      if (err.code === "ENOENT") throw new ProfileNotFoundError(name);
      throw err;
    });
  }
}

import { readdir, readFile, rm } from "node:fs/promises";
import { Paths } from "../util/Paths.js";
import { atomicWriteFile, toJsonWithTrailingNewline } from "../util/atomicWrite.js";
import { ModuleExistsError, ModuleNotFoundError } from "../util/errors.js";
import { readOptionalJsonFile } from "../util/jsonFile.js";
import { emptyModule, Module, normalizeModule } from "./types.js";
import { validateModuleName } from "./moduleName.js";

/** CRUD over module directories (each holding a settings.json) under $CLAUDE_MODULES_HOME/modules. */
export class ModuleStore {
  constructor(private readonly paths: Paths) {}

  async list(): Promise<string[]> {
    const entries = await readdir(this.paths.modulesDir, { withFileTypes: true }).catch((err) => {
      if (err.code === "ENOENT") return [];
      throw err;
    });
    const dirs = entries.filter((entry) => entry.isDirectory());
    const names = await Promise.all(
      dirs.map(async (entry) => ((await this.settingsFileExists(entry.name)) ? entry.name : null))
    );
    return names.filter((name): name is string => name !== null).sort();
  }

  async exists(name: string): Promise<boolean> {
    validateModuleName(name);
    return this.settingsFileExists(name);
  }

  async load(name: string): Promise<Module> {
    validateModuleName(name);
    const parsed = await readOptionalJsonFile<Partial<Module>>(
      this.paths.moduleSettingsFile(name),
      () => {
        throw new ModuleNotFoundError(name);
      },
      `Module '${name}' (${this.paths.moduleSettingsFile(name)})`,
      (err) => err.code === "ENOENT" || err.code === "ENOTDIR"
    );
    return normalizeModule(parsed, name);
  }

  async create(name: string): Promise<void> {
    validateModuleName(name);
    if (await this.exists(name)) {
      throw new ModuleExistsError(name);
    }
    await this.save(name, emptyModule());
  }

  async save(name: string, module: Module): Promise<void> {
    validateModuleName(name);
    const { composedModules, ...rest } = module;
    const serializable = composedModules.length > 0 ? { ...rest, composedModules } : rest;
    await atomicWriteFile(this.paths.moduleSettingsFile(name), toJsonWithTrailingNewline(serializable));
  }

  /** Bumps `module.version` in place via `bump`, then saves — the mutate-bump-save idiom every write path uses. */
  async saveWithBump(name: string, module: Module, bump: (version: string) => string): Promise<void> {
    module.version = bump(module.version);
    await this.save(name, module);
  }

  async remove(name: string): Promise<void> {
    validateModuleName(name);
    // force is deliberately omitted: a missing directory must still reject with ENOENT below,
    // which is how a not-found module is reported.
    await rm(this.paths.moduleDir(name), { recursive: true }).catch((err) => {
      if (err.code === "ENOENT") throw new ModuleNotFoundError(name);
      throw err;
    });
  }

  /** Unvalidated existence check, safe to call with raw directory names straight from readdir. */
  private async settingsFileExists(name: string): Promise<boolean> {
    return readFile(this.paths.moduleSettingsFile(name), "utf8")
      .then(() => true)
      .catch(() => false);
  }
}

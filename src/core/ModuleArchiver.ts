import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { Paths } from "../util/Paths.js";
import { atomicWriteFile, toJsonWithTrailingNewline } from "../util/atomicWrite.js";
import {
  CompositionCycleError,
  DuplicateImportNameError,
  InvalidExportArchiveError,
  ModuleImportCollisionError,
} from "../util/errors.js";
import { warnIfNonPortableMarketplace } from "./marketplacePortability.js";
import { CompositionResolver } from "./CompositionResolver.js";
import { ModuleStore } from "./ModuleStore.js";
import { Module } from "./types.js";
import { Logger } from "../util/Logger.js";

const MANIFEST_VERSION = 1;

interface ExportManifest {
  version: number;
  rootModule: string;
  composedModules: string[];
  exportedAt: string;
}

export interface ExportResult {
  outputPath: string;
  rootModule: string;
  composedModules: string[];
}

export interface ImportResult {
  rootModule: string;
  composedModules: string[];
}

/**
 * Packages a module — and the full transitive closure of everything it `composedModules` —
 * into a portable `.tar.gz`, and unpacks one back onto disk. Whole module directories are
 * archived (not just settings.json), so this stays correct as modules grow beyond a single file.
 */
export class ModuleArchiver {
  constructor(
    private readonly paths: Paths,
    private readonly moduleStore: ModuleStore,
    private readonly compositionResolver: CompositionResolver,
    private readonly logger: Logger
  ) {}

  /** Root name first, then every transitively composed module, deduped. Mirrors CompositionResolver's cycle detection. */
  async collectClosure(name: string): Promise<string[]> {
    const seen = new Set<string>();
    await this.walkClosure(name, [], seen);
    return [...seen];
  }

  private async walkClosure(name: string, path: readonly string[], seen: Set<string>): Promise<void> {
    if (path.includes(name)) throw new CompositionCycleError([...path, name]);
    if (seen.has(name)) return;
    const module = await this.moduleStore.load(name);
    seen.add(name);
    const nextPath = [...path, name];
    for (const childName of module.composedModules) {
      await this.walkClosure(childName, nextPath, seen);
    }
  }

  async export(rootModule: string, outputPath: string): Promise<ExportResult> {
    const closure = await this.collectClosure(rootModule);
    await this.warnNonPortableMarketplaces(closure);

    const staging = await mkdtemp(join(tmpdir(), "claude-modules-export-"));
    try {
      const manifest: ExportManifest = {
        version: MANIFEST_VERSION,
        rootModule,
        composedModules: closure.filter((name) => name !== rootModule),
        exportedAt: new Date().toISOString(),
      };
      await atomicWriteFile(join(staging, "manifest.json"), toJsonWithTrailingNewline(manifest));

      for (const name of closure) {
        const dest = join(staging, "modules", name);
        await mkdir(dest, { recursive: true });
        await cp(this.paths.moduleDir(name), dest, { recursive: true });
      }

      await mkdir(join(outputPath, ".."), { recursive: true });
      await tar.create({ gzip: true, file: outputPath, cwd: staging }, ["manifest.json", "modules"]);

      return { outputPath, rootModule, composedModules: manifest.composedModules };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async import(
    archivePath: string,
    options: { name: string | undefined; composedPrefix: string | undefined; dryRun: boolean | undefined }
  ): Promise<ImportResult> {
    const extractDir = await mkdtemp(join(tmpdir(), "claude-modules-import-"));
    try {
      await tar.extract({ file: archivePath, cwd: extractDir });

      const manifest = await this.readManifest(extractDir);
      const rootName = options.name ?? manifest.rootModule;
      const nameMap = new Map<string, string>([[manifest.rootModule, rootName]]);
      for (const composedName of manifest.composedModules) {
        nameMap.set(composedName, options.composedPrefix ? `${options.composedPrefix}${composedName}` : composedName);
      }

      await this.verifyArchiveContents(extractDir, manifest);
      this.checkNameMapIsInjective(nameMap);
      await this.checkCollisions(nameMap, manifest.rootModule);
      if (!options.dryRun) {
        await this.copyRenamed(extractDir, nameMap);
        // A composed module can arrive with a pre-existing marketplace conflict — composedModules
        // is only ever validated at 'create --compose' time, so hand-editing it (the README's only
        // way to change it afterward) can produce an archive that already has one. The collision
        // pre-check above only catches name clashes, not this, so it's still possible here. The
        // modules are already written at this point, so this is reported, not rolled back.
        await this.compositionResolver.resolveEffective(rootName).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Imported module '${rootName}', but its composition doesn't currently resolve: ${message}`
          );
        });
      }

      return {
        rootModule: rootName,
        composedModules: manifest.composedModules.map((name) => nameMap.get(name)!),
      };
    } finally {
      await rm(extractDir, { recursive: true, force: true });
    }
  }

  private async warnNonPortableMarketplaces(moduleNames: readonly string[]): Promise<void> {
    for (const name of moduleNames) {
      const module = await this.moduleStore.load(name);
      for (const [marketplace, source] of Object.entries(module.extraKnownMarketplaces)) {
        warnIfNonPortableMarketplace(this.logger, marketplace, source);
      }
    }
  }

  private async readManifest(extractDir: string): Promise<ExportManifest> {
    const raw = await readFile(join(extractDir, "manifest.json"), "utf8").catch(() => {
      throw new InvalidExportArchiveError("missing manifest.json — this doesn't look like a 'claude-modules export' archive.");
    });
    let parsed: Partial<ExportManifest>;
    try {
      parsed = JSON.parse(raw) as Partial<ExportManifest>;
    } catch {
      throw new InvalidExportArchiveError("manifest.json is not valid JSON.");
    }
    if (typeof parsed.rootModule !== "string" || !Array.isArray(parsed.composedModules)) {
      throw new InvalidExportArchiveError("manifest.json is missing 'rootModule' or 'composedModules'.");
    }
    const version = parsed.version ?? MANIFEST_VERSION;
    if (version !== MANIFEST_VERSION) {
      throw new InvalidExportArchiveError(
        `manifest.json is version ${version}, but this build of claude-modules only understands version ${MANIFEST_VERSION}. Upgrade claude-modules and try again.`
      );
    }
    return {
      version,
      rootModule: parsed.rootModule,
      composedModules: parsed.composedModules,
      exportedAt: parsed.exportedAt ?? "",
    };
  }

  private async verifyArchiveContents(extractDir: string, manifest: ExportManifest): Promise<void> {
    for (const name of [manifest.rootModule, ...manifest.composedModules]) {
      const exists = await stat(join(extractDir, "modules", name))
        .then((s) => s.isDirectory())
        .catch(() => false);
      if (!exists) {
        throw new InvalidExportArchiveError(`manifest.json promises module '${name}', but the archive has no such directory.`);
      }
    }
  }

  /** --name/--composed-prefix can independently be chosen to land on the same final name; catch that before any write. */
  private checkNameMapIsInjective(nameMap: ReadonlyMap<string, string>): void {
    const originalNamesByFinalName = new Map<string, string[]>();
    for (const [originalName, finalName] of nameMap) {
      const originals = originalNamesByFinalName.get(finalName) ?? [];
      originals.push(originalName);
      originalNamesByFinalName.set(finalName, originals);
    }
    for (const [finalName, originalNames] of originalNamesByFinalName) {
      if (originalNames.length > 1) throw new DuplicateImportNameError(finalName, originalNames);
    }
  }

  private async checkCollisions(nameMap: ReadonlyMap<string, string>, rootOriginalName: string): Promise<void> {
    const collisions: { name: string; kind: "root" | "composed" }[] = [];
    for (const [originalName, finalName] of nameMap) {
      if (await this.moduleStore.exists(finalName)) {
        collisions.push({ name: finalName, kind: originalName === rootOriginalName ? "root" : "composed" });
      }
    }
    if (collisions.length > 0) throw new ModuleImportCollisionError(collisions);
  }

  private async copyRenamed(extractDir: string, nameMap: ReadonlyMap<string, string>): Promise<void> {
    for (const [originalName, finalName] of nameMap) {
      const source = join(extractDir, "modules", originalName);
      const settingsPath = join(source, "settings.json");
      const raw = await readFile(settingsPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<Module>;
      const rewritten: Module = {
        enabledPlugins: parsed.enabledPlugins ?? {},
        extraKnownMarketplaces: parsed.extraKnownMarketplaces ?? {},
        composedModules: (parsed.composedModules ?? []).map((childName) => nameMap.get(childName) ?? childName),
      };
      await atomicWriteFile(settingsPath, toJsonWithTrailingNewline(rewritten));

      const dest = this.paths.moduleDir(finalName);
      await mkdir(dest, { recursive: true });
      await cp(source, dest, { recursive: true });
    }
  }
}

import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rename, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { Paths } from "../util/Paths.js";
import { atomicWriteFile, toJsonWithTrailingNewline } from "../util/atomicWrite.js";
import { isDirectory } from "../util/fsProbe.js";
import {
  CompositionCycleError,
  describeError,
  DuplicateImportNameError,
  InvalidExportArchiveError,
  ModuleImportCollisionError,
} from "../util/errors.js";
import { warnIfNonPortableMarketplace } from "./marketplacePortability.js";
import { CompositionResolver } from "./CompositionResolver.js";
import { ModuleStore } from "./ModuleStore.js";
import { Module, normalizeModule } from "./types.js";
import { Logger } from "../util/Logger.js";
import { ExportManifest, MANIFEST_VERSION, parseManifest } from "./exportManifest.js";

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
      // Temp-file-then-rename, same pattern atomicWriteFile uses elsewhere in this codebase, applied
      // one level up at the archive itself: tar.create writes directly for a while before it's done,
      // so a crash mid-write must never leave a truncated file at outputPath, and must never clobber
      // a pre-existing good archive there either.
      const tmpOutputPath = `${outputPath}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        await tar.create({ gzip: true, file: tmpOutputPath, cwd: staging }, ["manifest.json", "modules"]);
        await rename(tmpOutputPath, outputPath);
      } catch (err) {
        await unlink(tmpOutputPath).catch(() => {});
        throw err;
      }

      return { outputPath, rootModule, composedModules: manifest.composedModules };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async import(
    archivePath: string,
    options: { name: string | undefined; composedPrefix: string | undefined; dryRun: boolean | undefined }
  ): Promise<ImportResult> {
    // A dry run must not write anything — not even to a temp directory — so it validates against a
    // list-mode pass over the archive (entry names + manifest.json's content, read in memory) rather
    // than a real extraction. It can validate everything a real import checks *before* writing: the
    // manifest, that every promised module directory is actually present, and name collisions. The
    // one thing it correctly can't do is the post-write composition re-check below, since nothing
    // was written for it to re-check.
    if (options.dryRun) {
      const { entryPaths, manifestRaw } = await this.listArchiveEntries(archivePath);
      const manifest = parseManifest(manifestRaw);
      this.verifyArchiveContentsFromEntries(entryPaths, manifest);
      const nameMap = this.buildNameMap(manifest, options);
      this.checkNameMapIsInjective(nameMap);
      await this.checkCollisions(nameMap, manifest.rootModule);
      return {
        rootModule: nameMap.get(manifest.rootModule)!,
        composedModules: manifest.composedModules.map((name) => nameMap.get(name)!),
      };
    }

    const extractDir = await mkdtemp(join(tmpdir(), "claude-modules-import-"));
    try {
      await tar.extract({ file: archivePath, cwd: extractDir });

      const manifestRaw = await readFile(join(extractDir, "manifest.json"), "utf8").catch(() => undefined);
      const manifest = parseManifest(manifestRaw);
      await this.verifyArchiveContents(extractDir, manifest);
      const nameMap = this.buildNameMap(manifest, options);
      this.checkNameMapIsInjective(nameMap);
      await this.checkCollisions(nameMap, manifest.rootModule);

      await this.copyRenamed(extractDir, nameMap, manifest.rootModule);
      const rootName = nameMap.get(manifest.rootModule)!;
      // A composed module can arrive with a pre-existing marketplace conflict — composedModules
      // is only ever validated at 'create --compose' time, so hand-editing it (the README's only
      // way to change it afterward) can produce an archive that already has one. The collision
      // pre-check above only catches name clashes, not this, so it's still possible here. The
      // modules are already written at this point, so this is reported, not rolled back.
      await this.compositionResolver.resolveEffective(rootName).catch((err: unknown) => {
        this.logger.warn(
          `Imported module '${rootName}', but its composition doesn't currently resolve: ${describeError(err)}`
        );
      });

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

  /**
   * Lists an archive's entries without extracting anything to disk: entry paths (enough to confirm
   * every promised module directory exists) and manifest.json's content specifically, captured from
   * its entry stream in memory. Every other entry is left to `tar.t`'s default auto-resume behavior.
   */
  private async listArchiveEntries(
    archivePath: string
  ): Promise<{ entryPaths: Set<string>; manifestRaw: string | undefined }> {
    const entryPaths = new Set<string>();
    const manifestChunks: Buffer[] = [];
    await tar.t({
      file: archivePath,
      onReadEntry: (entry) => {
        entryPaths.add(entry.path);
        if (entry.path === "manifest.json") {
          entry.on("data", (chunk: Buffer) => manifestChunks.push(chunk));
        }
      },
    });
    return {
      entryPaths,
      manifestRaw: manifestChunks.length > 0 ? Buffer.concat(manifestChunks).toString("utf8") : undefined,
    };
  }

  private buildNameMap(
    manifest: ExportManifest,
    options: { name: string | undefined; composedPrefix: string | undefined }
  ): Map<string, string> {
    const rootName = options.name ?? manifest.rootModule;
    const nameMap = new Map<string, string>([[manifest.rootModule, rootName]]);
    for (const composedName of manifest.composedModules) {
      nameMap.set(composedName, options.composedPrefix ? `${options.composedPrefix}${composedName}` : composedName);
    }
    return nameMap;
  }

  private async verifyArchiveContents(extractDir: string, manifest: ExportManifest): Promise<void> {
    for (const name of [manifest.rootModule, ...manifest.composedModules]) {
      const exists = await isDirectory(join(extractDir, "modules", name));
      if (!exists) {
        throw new InvalidExportArchiveError(`manifest.json promises module '${name}', but the archive has no such directory.`);
      }
    }
  }

  /** Same check as `verifyArchiveContents`, against a list-mode entry-path set instead of the disk. */
  private verifyArchiveContentsFromEntries(entryPaths: ReadonlySet<string>, manifest: ExportManifest): void {
    for (const name of [manifest.rootModule, ...manifest.composedModules]) {
      const prefix = `modules/${name}/`;
      const exists = [...entryPaths].some((path) => path === `modules/${name}` || path.startsWith(prefix));
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
    const collisions: { name: string; kind: "root" | "composed"; hasSettings: boolean }[] = [];
    for (const [originalName, finalName] of nameMap) {
      // A loadable settings.json is the common case, but a bare `modules/<name>/` directory with no
      // (or an unreadable) settings.json can also exist — typically a leftover from an import that
      // crashed partway through `copyRenamed` below. Treating only `moduleStore.exists` (a *loadable*
      // settings.json) as a collision would let a retry silently merge into that stale partial state
      // instead of erroring on it.
      const hasSettings = await this.moduleStore.exists(finalName);
      const collides = hasSettings || (await this.directoryExists(finalName));
      if (collides) {
        collisions.push({ name: finalName, kind: originalName === rootOriginalName ? "root" : "composed", hasSettings });
      }
    }
    if (collisions.length > 0) throw new ModuleImportCollisionError(collisions);
  }

  private async directoryExists(name: string): Promise<boolean> {
    return isDirectory(this.paths.moduleDir(name));
  }

  /**
   * Writes composed (leaf) modules before the root, deliberately the opposite of `nameMap`'s
   * root-first iteration order: the root is what makes an import "look done" (it's the name the user
   * asked to import, and what a later `enable`/`info` would be run against), so if a crash happens
   * partway through, leaving it unwritten means the import as a whole still reads as failed rather
   * than as a visible-but-broken root that then fails oddly later with `ModuleNotFoundError` on a
   * composed child the user never named.
   */
  private async copyRenamed(
    extractDir: string,
    nameMap: ReadonlyMap<string, string>,
    rootOriginalName: string
  ): Promise<void> {
    const entries = [...nameMap.entries()];
    const ordered = [
      ...entries.filter(([originalName]) => originalName !== rootOriginalName),
      ...entries.filter(([originalName]) => originalName === rootOriginalName),
    ];
    for (const [originalName, finalName] of ordered) {
      const source = join(extractDir, "modules", originalName);
      const settingsPath = join(source, "settings.json");
      const raw = await readFile(settingsPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<Module>;
      const rewritten: Module = {
        ...normalizeModule(parsed, finalName),
        composedModules: (parsed.composedModules ?? []).map((childName) => nameMap.get(childName) ?? childName),
      };
      await atomicWriteFile(settingsPath, toJsonWithTrailingNewline(rewritten));

      const dest = this.paths.moduleDir(finalName);
      await mkdir(dest, { recursive: true });
      await cp(source, dest, { recursive: true });
    }
  }
}

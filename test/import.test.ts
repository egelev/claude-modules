import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness } from "./helpers/harness.js";

describe("import", () => {
  let source: Harness;
  let dest: Harness;
  let archivePath: string;

  beforeEach(async () => {
    source = await Harness.create();
    dest = await Harness.create();
    archivePath = join(source.root, "archive.tar.gz");
  });

  afterEach(async () => {
    await source.cleanup();
    await dest.cleanup();
  });

  async function readDestModule(name: string): Promise<{ composedModules: string[] }> {
    const raw = await readFile(join(dest.modulesHome, "modules", name, "settings.json"), "utf8");
    return JSON.parse(raw);
  }

  it("round-trips a solo module", async () => {
    await source.run(["create", "backend"], source.root);
    await source.run(["export", "backend", "--output", archivePath], source.root);

    const result = await dest.run(["import", archivePath], dest.root);

    expect(result.code).toBe(0);
    const info = await dest.run(["info", "backend"]);
    expect(info.code).toBe(0);
  });

  it("round-trips a composition tree and composition still resolves", async () => {
    await source.run(["create", "base"]);
    await source.run(["plugin", "install", "base", "core@mp", "--source", JSON.stringify({ source: { source: "github", repo: "owner/repo" } })]);
    await source.run(["create", "top", "--compose", "base"]);
    await source.run(["export", "top", "--output", archivePath], source.root);

    const result = await dest.run(["import", archivePath], dest.root);
    expect(result.code).toBe(0);

    const info = await dest.run(["info", "top"]);
    expect(info.stdout).toContain("composes 1 module(s)");
    expect(info.stdout).toContain("base");

    await dest.writeInstalledPlugins(["core@mp"]);
    const enableResult = await dest.run(["enable", "top"]);
    expect(enableResult.code).toBe(0);
    const settings = await dest.readSettings("local");
    expect(settings.enabledPlugins).toEqual({ "core@mp": true });
  });

  it("carries a module's recorded version through unchanged, for both root and composed modules", async () => {
    await source.run(["create", "base"]);
    await source.run([
      "plugin",
      "install",
      "base",
      "core@mp",
      "--source",
      JSON.stringify({ source: { source: "github", repo: "owner/repo" } }),
    ]); // base is now 1.0.1
    await source.run(["create", "top", "--compose", "base"]); // top starts at 1.0.0
    await source.run([
      "marketplace",
      "add",
      "owner/other",
      "--name",
      "other-mp",
      "--module",
      "top",
    ]); // top is now 1.0.1
    await source.run(["export", "top", "--output", archivePath], source.root);

    const result = await dest.run(["import", archivePath], dest.root);

    expect(result.code).toBe(0);
    const topInfo = await dest.run(["info", "top"]);
    const baseInfo = await dest.run(["info", "base"]);
    expect(topInfo.stdout).toContain("(v1.0.1)");
    expect(baseInfo.stdout).toContain("(v1.0.1)");
  });

  it("--name renames only the root module", async () => {
    await source.run(["create", "base"]);
    await source.run(["create", "top", "--compose", "base"]);
    await source.run(["export", "top", "--output", archivePath], source.root);

    const result = await dest.run(["import", archivePath, "--name", "top-renamed"], dest.root);

    expect(result.code).toBe(0);
    expect((await dest.run(["info", "top-renamed"])).code).toBe(0);
    expect((await dest.run(["info", "base"])).code).toBe(0);
    expect((await readDestModule("top-renamed")).composedModules).toEqual(["base"]);
  });

  it("rejects a root-name collision, recommending --name", async () => {
    await source.run(["create", "backend"]);
    await source.run(["export", "backend", "--output", archivePath], source.root);
    await dest.run(["create", "backend"]);

    const result = await dest.run(["import", archivePath], dest.root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("backend");
    expect(result.stderr).toContain("--name");
  });

  it("rejects a composed-module collision, recommending --composed-prefix, then succeeds with it", async () => {
    await source.run(["create", "base"]);
    await source.run(["create", "top", "--compose", "base"]);
    await source.run(["export", "top", "--output", archivePath], source.root);
    await dest.run(["create", "base"]);

    const blocked = await dest.run(["import", archivePath], dest.root);
    expect(blocked.code).toBe(1);
    expect(blocked.stderr).toContain("base");
    expect(blocked.stderr).toContain("--composed-prefix");
    expect((await dest.run(["info", "top"])).code).toBe(1);

    const result = await dest.run(["import", archivePath, "--composed-prefix", "teammate-"], dest.root);
    expect(result.code).toBe(0);
    expect((await dest.run(["info", "teammate-base"])).code).toBe(0);
    expect((await readDestModule("top")).composedModules).toEqual(["teammate-base"]);
  });

  it("rewrites composedModules at every level when --composed-prefix is used", async () => {
    await source.run(["create", "base"]);
    await source.run(["create", "mid", "--compose", "base"]);
    await source.run(["create", "top", "--compose", "mid"]);
    await source.run(["export", "top", "--output", archivePath], source.root);

    const result = await dest.run(["import", archivePath, "--composed-prefix", "x-"], dest.root);

    expect(result.code).toBe(0);
    expect((await readDestModule("top")).composedModules).toEqual(["x-mid"]);
    expect((await readDestModule("x-mid")).composedModules).toEqual(["x-base"]);
  });

  it("detects a bare module directory with no settings.json as a collision, with different advice than a real module", async () => {
    // Simulates a leftover from a prior import that crashed partway through copyRenamed: a module
    // directory exists on disk with no (readable) settings.json. moduleStore.exists (a *loadable*
    // settings.json check) would miss this, letting a retry silently merge into the stale partial
    // state instead of erroring on it.
    await source.run(["create", "backend"]);
    await source.run(["export", "backend", "--output", archivePath], source.root);
    await mkdir(join(dest.modulesHome, "modules", "backend"), { recursive: true });

    const result = await dest.run(["import", archivePath], dest.root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("backend");
    expect(result.stderr).toContain("no readable settings.json");
    expect(result.stderr).not.toContain("--name");
  });

  it("rejects an archive with no manifest.json", async () => {
    const staging = join(source.root, "bad-staging");
    await mkdir(join(staging, "modules", "backend"), { recursive: true });
    await writeFile(join(staging, "modules", "backend", "settings.json"), "{}\n", "utf8");
    const badArchive = join(source.root, "bad.tar.gz");
    await tar.create({ gzip: true, file: badArchive, cwd: staging }, ["modules"]);

    const result = await dest.run(["import", badArchive], dest.root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("manifest.json");
  });

  it("rejects an archive whose manifest promises a missing module directory", async () => {
    const staging = join(source.root, "bad-staging-2");
    await mkdir(join(staging, "modules", "backend"), { recursive: true });
    await writeFile(join(staging, "modules", "backend", "settings.json"), "{}\n", "utf8");
    await writeFile(
      join(staging, "manifest.json"),
      JSON.stringify({ version: 1, rootModule: "backend", composedModules: ["ghost"], exportedAt: "" }),
      "utf8"
    );
    const badArchive = join(source.root, "bad2.tar.gz");
    await tar.create({ gzip: true, file: badArchive, cwd: staging }, ["manifest.json", "modules"]);

    const result = await dest.run(["import", badArchive], dest.root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ghost");
  });

  it("a non-string composedModules entry in the manifest crashes with a raw TypeError on real import — known gap: parseManifest never validates entry types", async () => {
    // parseManifest only checks Array.isArray(composedModules), never that each entry is a string.
    // The real-import path's verifyArchiveContents does join(extractDir, "modules", name) on the
    // raw manifest value — node:path's join() throws synchronously on a non-string argument, so
    // this surfaces as an unhandled TypeError [ERR_INVALID_ARG_TYPE], not InvalidExportArchiveError.
    // (The --dry-run path happens to dodge this one via template-literal string coercion in
    // verifyArchiveContentsFromEntries, landing on a clean "no such directory" error instead — an
    // inconsistency in the opposite direction from the corrupt-settings.json gap above.)
    const staging = join(source.root, "bad-type-staging");
    await mkdir(join(staging, "modules", "top"), { recursive: true });
    await writeFile(join(staging, "modules", "top", "settings.json"), "{}\n", "utf8");
    await writeFile(
      join(staging, "manifest.json"),
      JSON.stringify({ version: 1, rootModule: "top", composedModules: [42], exportedAt: "" }),
      "utf8"
    );
    const badArchive = join(source.root, "bad-type.tar.gz");
    await tar.create({ gzip: true, file: badArchive, cwd: staging }, ["manifest.json", "modules"]);

    const result = await dest.run(["import", badArchive], dest.root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("TypeError");
    expect(result.stderr).not.toContain("Not a valid module export archive");
  });

  it("writes nothing under --dry-run", async () => {
    await source.run(["create", "base"]);
    await source.run(["create", "top", "--compose", "base"]);
    await source.run(["export", "top", "--output", archivePath], source.root);

    const result = await dest.run(["import", archivePath, "--dry-run"], dest.root);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("top");
    expect((await dest.run(["list"])).stdout).toContain("No modules found");
  });

  it("still reports a collision under --dry-run", async () => {
    await source.run(["create", "backend"]);
    await source.run(["export", "backend", "--output", archivePath], source.root);
    await dest.run(["create", "backend"]);

    const result = await dest.run(["import", archivePath, "--dry-run"], dest.root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--name");
  });

  it("still rejects an unsupported manifest version under --dry-run, the same way a real import does", async () => {
    const staging = join(source.root, "future-staging");
    await mkdir(join(staging, "modules", "backend"), { recursive: true });
    await writeFile(join(staging, "modules", "backend", "settings.json"), "{}\n", "utf8");
    await writeFile(
      join(staging, "manifest.json"),
      JSON.stringify({ version: 99, rootModule: "backend", composedModules: [], exportedAt: "" }),
      "utf8"
    );
    const futureArchive = join(source.root, "future.tar.gz");
    await tar.create({ gzip: true, file: futureArchive, cwd: staging }, ["manifest.json", "modules"]);

    const result = await dest.run(["import", futureArchive, "--dry-run"], dest.root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("version 99");
  });

  it("still rejects a missing promised module directory under --dry-run", async () => {
    const staging = join(source.root, "bad-staging-3");
    await mkdir(join(staging, "modules", "backend"), { recursive: true });
    await writeFile(join(staging, "modules", "backend", "settings.json"), "{}\n", "utf8");
    await writeFile(
      join(staging, "manifest.json"),
      JSON.stringify({ version: 1, rootModule: "backend", composedModules: ["ghost"], exportedAt: "" }),
      "utf8"
    );
    const badArchive = join(source.root, "bad3.tar.gz");
    await tar.create({ gzip: true, file: badArchive, cwd: staging }, ["manifest.json", "modules"]);

    const result = await dest.run(["import", badArchive, "--dry-run"], dest.root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ghost");
  });

  it("dry-run reports success for an archive whose composed module has malformed settings.json — a known gap: verification only checks directory presence, never content", async () => {
    // verifyArchiveContentsFromEntries (the dry-run path) only confirms 'modules/<name>' has a
    // matching entry in the archive — it never reads or parses that module's settings.json. A real
    // import of this same archive does not succeed the same way (see the next test) — that
    // divergence is the gap this test pins, not a desired behavior.
    const staging = join(source.root, "corrupt-staging");
    await mkdir(join(staging, "modules", "top"), { recursive: true });
    await writeFile(
      join(staging, "modules", "top", "settings.json"),
      JSON.stringify({ version: "1.0.0", enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: ["good", "bad"] }),
      "utf8"
    );
    await mkdir(join(staging, "modules", "good"), { recursive: true });
    await writeFile(
      join(staging, "modules", "good", "settings.json"),
      JSON.stringify({ version: "1.0.0", enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] }),
      "utf8"
    );
    await mkdir(join(staging, "modules", "bad"), { recursive: true });
    await writeFile(join(staging, "modules", "bad", "settings.json"), "not valid json{", "utf8");
    await writeFile(
      join(staging, "manifest.json"),
      JSON.stringify({ version: 1, rootModule: "top", composedModules: ["good", "bad"], exportedAt: "" }),
      "utf8"
    );
    const corruptArchive = join(source.root, "corrupt.tar.gz");
    await tar.create({ gzip: true, file: corruptArchive, cwd: staging }, ["manifest.json", "modules"]);

    const result = await dest.run(["import", corruptArchive, "--dry-run"], dest.root);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("top");
  });

  it("a real import of the same corrupt archive crashes partway through and leaves an orphaned module directory behind — known gap, no rollback", async () => {
    // copyRenamed writes composed (leaf) modules before the root, and its readFile/JSON.parse of
    // each member's settings.json has no try/catch. 'good' is processed (and fully written to the
    // real modules directory) before 'bad' crashes the run, so it survives on disk with nothing to
    // clean it up; 'top' — the root, processed last — is never reached at all.
    const staging = join(source.root, "corrupt-staging-2");
    await mkdir(join(staging, "modules", "top"), { recursive: true });
    await writeFile(
      join(staging, "modules", "top", "settings.json"),
      JSON.stringify({ version: "1.0.0", enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: ["good", "bad"] }),
      "utf8"
    );
    await mkdir(join(staging, "modules", "good"), { recursive: true });
    await writeFile(
      join(staging, "modules", "good", "settings.json"),
      JSON.stringify({ version: "1.0.0", enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] }),
      "utf8"
    );
    await mkdir(join(staging, "modules", "bad"), { recursive: true });
    await writeFile(join(staging, "modules", "bad", "settings.json"), "not valid json{", "utf8");
    await writeFile(
      join(staging, "manifest.json"),
      JSON.stringify({ version: 1, rootModule: "top", composedModules: ["good", "bad"], exportedAt: "" }),
      "utf8"
    );
    const corruptArchive = join(source.root, "corrupt2.tar.gz");
    await tar.create({ gzip: true, file: corruptArchive, cwd: staging }, ["manifest.json", "modules"]);

    const result = await dest.run(["import", corruptArchive], dest.root);

    // Not a clean InvalidExportArchiveError — this is whatever raw SyntaxError Node/JSON.parse
    // produces, caught only by Cli.ts's generic non-CliError fallback (exit code 1).
    expect(result.code).toBe(1);
    expect((await dest.run(["info", "top"])).code).toBe(1);
    expect((await dest.run(["info", "good"])).code).toBe(0);
  });

  it("creates no directory under the OS temp dir during --dry-run — validation reads the archive in memory, never extracts it", async () => {
    await source.run(["create", "base"]);
    await source.run(["create", "top", "--compose", "base"]);
    await source.run(["export", "top", "--output", archivePath], source.root);

    const before = await readdir(tmpdir());
    const result = await dest.run(["import", archivePath, "--dry-run"], dest.root);
    const after = await readdir(tmpdir());

    expect(result.code).toBe(0);
    expect(after.filter((name) => name.startsWith("claude-modules-import-"))).toEqual(
      before.filter((name) => name.startsWith("claude-modules-import-"))
    );
  });

  it("errors on a nonexistent archive path", async () => {
    const result = await dest.run(["import", join(dest.root, "does-not-exist.tar.gz")], dest.root);

    expect(result.code).toBe(1);
  });

  it("rejects --name colliding with a composed module's final name, before writing anything", async () => {
    await source.run(["create", "base"]);
    await source.run(["create", "top", "--compose", "base"]);
    await source.run(["export", "top", "--output", archivePath], source.root);

    const result = await dest.run(["import", archivePath, "--name", "base"], dest.root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("more than one module the name 'base'");
    expect((await dest.run(["info", "base"])).code).toBe(1);
  });

  it("rejects an unsupported manifest version", async () => {
    const staging = join(source.root, "future-staging");
    await mkdir(join(staging, "modules", "backend"), { recursive: true });
    await writeFile(join(staging, "modules", "backend", "settings.json"), "{}\n", "utf8");
    await writeFile(
      join(staging, "manifest.json"),
      JSON.stringify({ version: 99, rootModule: "backend", composedModules: [], exportedAt: "" }),
      "utf8"
    );
    const futureArchive = join(source.root, "future.tar.gz");
    await tar.create({ gzip: true, file: futureArchive, cwd: staging }, ["manifest.json", "modules"]);

    const result = await dest.run(["import", futureArchive], dest.root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("version 99");
  });

  it("warns (does not fail) when an imported composition has a pre-existing marketplace conflict", async () => {
    const mpA = { source: { source: "github", repo: "owner/a" } };
    const mpB = { source: { source: "github", repo: "owner/b" } };
    await source.writeModule("left", { enabledPlugins: {}, extraKnownMarketplaces: { mp: mpA }, composedModules: [] });
    await source.writeModule("right", { enabledPlugins: {}, extraKnownMarketplaces: { mp: mpB }, composedModules: [] });
    // Hand-written, since 'create --compose' itself would reject this at creation time — this is
    // the "hand-edit composedModules" path the README says is unvalidated until first resolved.
    await source.writeModule("top", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: ["left", "right"] });
    await source.run(["export", "top", "--output", archivePath], source.root);

    const result = await dest.run(["import", archivePath], dest.root);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("doesn't currently resolve");
    expect((await dest.run(["info", "top"])).code).toBe(0);
    expect((await dest.run(["info", "left"])).code).toBe(0);
    expect((await dest.run(["info", "right"])).code).toBe(0);
  });
});

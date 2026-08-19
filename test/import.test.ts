import { mkdir, readFile, writeFile } from "node:fs/promises";
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
    await source.run(["plugin", "install", "core@mp", "--module", "base", "--source", JSON.stringify({ source: { source: "github", repo: "owner/repo" } })]);
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

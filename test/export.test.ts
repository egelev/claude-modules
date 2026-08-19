import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness, githubSource } from "./helpers/harness.js";

describe("export", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  async function extract(archivePath: string): Promise<string> {
    const dest = join(h.root, "extracted");
    await mkdir(dest, { recursive: true });
    await tar.extract({ file: archivePath, cwd: dest });
    return dest;
  }

  it("archives a solo module with the default filename", async () => {
    await h.run(["create", "backend"]);

    const result = await h.run(["export", "backend"], h.root);

    expect(result.code).toBe(0);
    const expectedName = /backend-\d{4}-\d{2}-\d{2}\.tar\.gz/;
    expect(result.stdout).toMatch(expectedName);
    const match = result.stdout.match(expectedName);
    expect(match).not.toBeNull();

    const archivePath = join(h.root, match![0]);
    expect((await stat(archivePath)).isFile()).toBe(true);

    const extracted = await extract(archivePath);
    const manifest = JSON.parse(await readFile(join(extracted, "manifest.json"), "utf8"));
    expect(manifest.rootModule).toBe("backend");
    expect(manifest.composedModules).toEqual([]);
    expect((await stat(join(extracted, "modules", "backend", "settings.json"))).isFile()).toBe(true);
  });

  it("honors --output", async () => {
    await h.run(["create", "backend"]);
    const outPath = join(h.root, "custom.tar.gz");

    const result = await h.run(["export", "backend", "--output", outPath], h.root);

    expect(result.code).toBe(0);
    expect((await stat(outPath)).isFile()).toBe(true);
  });

  it("includes the transitive closure of composed modules", async () => {
    await h.run(["create", "base"]);
    await h.run(["create", "mid", "--compose", "base"]);
    await h.run(["create", "top", "--compose", "mid"]);
    const outPath = join(h.root, "top.tar.gz");

    const result = await h.run(["export", "top", "--output", outPath], h.root);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("base");
    expect(result.stdout).toContain("mid");

    const extracted = await extract(outPath);
    const manifest = JSON.parse(await readFile(join(extracted, "manifest.json"), "utf8"));
    expect(manifest.rootModule).toBe("top");
    expect(new Set(manifest.composedModules)).toEqual(new Set(["base", "mid"]));
    for (const name of ["top", "mid", "base"]) {
      expect((await stat(join(extracted, "modules", name, "settings.json"))).isFile()).toBe(true);
    }
  });

  it("dedupes a diamond composition", async () => {
    await h.run(["create", "shared"]);
    await h.run(["create", "left", "--compose", "shared"]);
    await h.run(["create", "right", "--compose", "shared"]);
    await h.writeModule("top", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: ["left", "right"] });
    const outPath = join(h.root, "top.tar.gz");

    const result = await h.run(["export", "top", "--output", outPath], h.root);

    expect(result.code).toBe(0);
    const extracted = await extract(outPath);
    const manifest = JSON.parse(await readFile(join(extracted, "manifest.json"), "utf8"));
    expect(new Set(manifest.composedModules)).toEqual(new Set(["left", "right", "shared"]));
  });

  it("rejects a composition cycle without writing an archive", async () => {
    await h.writeModule("q", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: ["p"] });
    await h.writeModule("p", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: ["q"] });
    const outPath = join(h.root, "p.tar.gz");

    const result = await h.run(["export", "p", "--output", outPath], h.root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Composition cycle detected");
    expect(
      await stat(outPath)
        .then(() => true)
        .catch(() => false)
    ).toBe(false);
  });

  it("warns about a non-portable marketplace among the archived modules", async () => {
    await h.writeModule("backend", {
      enabledPlugins: { "a@local-mp": true },
      extraKnownMarketplaces: { "local-mp": { source: { source: "local", path: "/home/someone/plugins" } } },
      composedModules: [],
    });

    const result = await h.run(["export", "backend"], h.root);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("machine-specific");
  });

  it("does not warn for a portable github marketplace", async () => {
    await h.writeModule("backend", {
      enabledPlugins: { "a@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      composedModules: [],
    });

    const result = await h.run(["export", "backend"], h.root);

    expect(result.stderr).not.toContain("machine-specific");
  });

  it("writes nothing under --dry-run but reports the closure", async () => {
    await h.run(["create", "base"]);
    await h.run(["create", "top", "--compose", "base"]);
    const outPath = join(h.root, "top.tar.gz");

    const result = await h.run(["export", "top", "--output", outPath, "--dry-run"], h.root);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("base");
    expect(
      await stat(outPath)
        .then(() => true)
        .catch(() => false)
    ).toBe(false);
  });

  it("errors on a nonexistent module", async () => {
    const result = await h.run(["export", "does-not-exist"], h.root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("does not exist");
  });
});

import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness } from "./helpers/harness.js";

describe("remove", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("deletes an existing module's directory", async () => {
    await h.writeModule("demo", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });

    const result = await h.run(["remove", "demo"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Removed module 'demo'");
    const list = await h.run(["list"]);
    expect(list.stdout).not.toContain("demo");
    expect(list.stdout).toContain("No modules found");
  });

  it("is idempotent: warns rather than failing on a nonexistent module", async () => {
    const result = await h.run(["remove", "ghost"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("does not exist; nothing to remove");
  });

  it("leaves the module directory intact under --dry-run", async () => {
    await h.writeModule("demo", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });

    const result = await h.run(["remove", "demo", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("[dry-run]");
    const list = await h.run(["list"]);
    expect(list.stdout).toContain("demo");
  });

  it("warns when the removed module is still listed in this scope's saved module list", async () => {
    await h.writeModule("demo", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });
    await h.writeFileAt(".claude-modules.local", "demo\n");

    const result = await h.run(["remove", "demo"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("demo");
    expect(result.stderr).toContain(".claude-modules.local");
    expect(result.stderr).toContain("local scope");
  });

  it("still warns about a stale reference under --dry-run", async () => {
    await h.writeModule("demo", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });
    await h.writeFileAt(".claude-modules.local", "demo\n");

    const result = await h.run(["remove", "demo", "--dry-run"]);

    expect(result.stderr).toContain(".claude-modules.local");
  });

  it("does not warn when the removed module isn't referenced by any saved list", async () => {
    await h.writeModule("demo", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });
    await h.writeFileAt(".claude-modules.local", "other\n");

    const result = await h.run(["remove", "demo"]);

    expect(result.stderr).toBe("");
  });

  it("warns (does not delete) a stray directory with no settings.json, same as any other nonexistent module", async () => {
    // moduleStore.exists() requires a *loadable* settings.json, so this command's own
    // exists()-then-remove() guard treats a bare leftover directory (e.g. from an import that
    // crashed partway through) exactly like a module that was never created — it never reaches
    // ModuleStore.remove() at all, so the directory survives.
    await mkdir(join(h.modulesHome, "modules", "junk"), { recursive: true });

    const result = await h.run(["remove", "junk"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("does not exist; nothing to remove");
    const entries = await readdir(join(h.modulesHome, "modules"));
    expect(entries).toContain("junk");
  });

  it("ignores extra positionals beyond the module name", async () => {
    await h.writeModule("demo", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });

    const result = await h.run(["remove", "demo", "extra-arg"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Removed module 'demo'");
    const list = await h.run(["list"]);
    expect(list.stdout).toContain("No modules found");
  });
});

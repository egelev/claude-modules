import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness, githubSource } from "./helpers/harness.js";

describe("disable", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("backend", {
      enabledPlugins: { "jdtls@mp": true, "quarkus@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      composedModules: [],
    });
    await h.writeModule("frontend", {
      enabledPlugins: { "playwright@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      composedModules: [],
    });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("flips the union of named modules' plugins to false, keeping the keys", async () => {
    await h.run(["enable", "backend", "frontend"]);

    const result = await h.run(["disable", "backend"]);

    expect(result.code).toBe(0);
    const settings = await h.readSettings("local");
    expect(settings.enabledPlugins).toEqual({
      "jdtls@mp": false,
      "quarkus@mp": false,
      "playwright@mp": true,
    });
  });

  it("leaves plugins never present in settings.json untouched (no phantom false entry)", async () => {
    const result = await h.run(["disable", "backend"]);

    expect(result.code).toBe(0);
    const settings = await h.readSettings("local");
    expect(settings.enabledPlugins ?? {}).not.toHaveProperty("jdtls@mp");
  });

  it("targets the given scope", async () => {
    await h.run(["enable", "backend", "--scope", "project"]);

    const result = await h.run(["disable", "backend", "--scope", "project"]);

    expect(result.code).toBe(0);
    const settings = await h.readSettings("project");
    expect(settings.enabledPlugins).toEqual({ "jdtls@mp": false, "quarkus@mp": false });
  });

  it("writes nothing under --dry-run", async () => {
    await h.run(["enable", "backend"]);

    const result = await h.run(["disable", "backend", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("[dry-run]");
    const settings = await h.readSettings("local");
    expect(settings.enabledPlugins).toEqual({ "jdtls@mp": true, "quarkus@mp": true });
  });

  it("errors on a module that doesn't exist", async () => {
    const result = await h.run(["disable", "nope"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Module 'nope' does not exist");
  });

  it("rejects an unknown scope", async () => {
    const result = await h.run(["disable", "backend", "--scope", "galaxy"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid --scope 'galaxy'");
  });

  it("notes that a saved list still lists the module when run without --save", async () => {
    await h.run(["enable", "backend", "frontend", "--save"]);

    const result = await h.run(["disable", "backend"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("not saved");
    expect(result.stdout).toContain("still says");
    expect(result.stdout).toContain("backend, frontend");
    // The saved list itself is untouched by plain (non---save) disable.
    expect(await h.readModuleList("local")).toBe("backend\nfrontend\n");
  });

  it("omits the unsaved note when no saved list exists for the scope", async () => {
    const result = await h.run(["disable", "backend"]);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("not saved");
  });

  it("omits the unsaved note when --save is passed", async () => {
    await h.run(["enable", "backend", "--save"]);

    const result = await h.run(["disable", "backend", "--save"]);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("not saved");
  });
});

describe("disable --save", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("backend", { enabledPlugins: { "jdtls@mp": true }, extraKnownMarketplaces: {} });
    await h.writeModule("frontend", { enabledPlugins: { "playwright@mp": true }, extraKnownMarketplaces: {} });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("removes the given module from the scope's saved list", async () => {
    await h.run(["enable", "backend", "frontend", "--save"]);

    const result = await h.run(["disable", "backend", "--save"]);

    expect(result.code).toBe(0);
    expect(await h.readModuleList("local")).toBe("frontend\n");
  });

  it("is idempotent: a module not in the saved list is a warning, not an error", async () => {
    await h.run(["enable", "frontend", "--save"]);

    const result = await h.run(["disable", "backend", "--save"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("nothing to remove");
    expect(await h.readModuleList("local")).toBe("frontend\n");
  });

  it("is idempotent: no saved list at all is a warning, not an error", async () => {
    const result = await h.run(["disable", "backend", "--save"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("No saved module list");
    expect(await h.moduleListExists("local")).toBe(false);
  });

  it("writes nothing under --dry-run", async () => {
    await h.run(["enable", "backend", "--save"]);

    const result = await h.run(["disable", "backend", "--save", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("[dry-run]");
    expect(await h.readModuleList("local")).toBe("backend\n");
  });

  it("rejects --save=<path> — disable always targets the scope's own list", async () => {
    const result = await h.run(["disable", "backend", "--save=custom.list"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("does not take a path");
  });

  it("rejects --save=<path> before any module resolution, even for a module that doesn't exist", async () => {
    // Discriminates the guard's ordering: if it fired after module lookup, a nonexistent module
    // would surface as "does not exist" instead, since --save=<path> parses fine as a bare --save
    // once the =<path> half is silently dropped.
    const result = await h.run(["disable", "nonexistent-module", "--save=custom.list"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("does not take a path");
    expect(result.stderr).not.toContain("does not exist");
  });

  it("reports the resulting active module list after removal", async () => {
    await h.run(["enable", "backend", "frontend", "--save"]);

    const result = await h.run(["disable", "backend", "--save"]);

    expect(result.stdout).toContain("Modules active in local scope: [frontend]");
  });

  it("notes per-name which requested modules weren't in the saved list, on a mixed batch", async () => {
    // 'frontend' is a real module (exists on disk, so it resolves fine) but was never part of the
    // saved list — the case this note is for, distinct from a module that doesn't exist at all.
    await h.run(["enable", "backend", "--save"]);

    const result = await h.run(["disable", "backend", "frontend", "--save"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("not in list, skipped: frontend");
    expect(await h.readModuleList("local")).toBe("\n");
  });
});

describe("disable-all", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("backend", {
      enabledPlugins: { "jdtls@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      composedModules: [],
    });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("flips every known plugin key to false, regardless of which module enabled it", async () => {
    await h.run(["enable", "backend"]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true, "manually-added@mp": true } });

    const result = await h.run(["disable-all"]);

    expect(result.code).toBe(0);
    const settings = await h.readSettings("local");
    expect(settings.enabledPlugins).toEqual({ "jdtls@mp": false, "manually-added@mp": false });
  });

  it("preserves unrelated settings", async () => {
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true }, theme: "light" });

    await h.run(["disable-all"]);

    const settings = await h.readSettings("local");
    expect(settings.theme).toBe("light");
  });

  it("targets the given scope", async () => {
    await h.run(["enable", "backend", "--scope", "project"]);

    const result = await h.run(["disable-all", "--scope", "project"]);

    expect(result.code).toBe(0);
    const settings = await h.readSettings("project");
    expect(settings.enabledPlugins).toEqual({ "jdtls@mp": false });
  });

  it("writes nothing under --dry-run", async () => {
    await h.run(["enable", "backend"]);

    const result = await h.run(["disable-all", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("[dry-run]");
    const settings = await h.readSettings("local");
    expect(settings.enabledPlugins).toEqual({ "jdtls@mp": true });
  });

  it("rejects an unknown scope", async () => {
    const result = await h.run(["disable-all", "--scope", "galaxy"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid --scope 'galaxy'");
  });
});

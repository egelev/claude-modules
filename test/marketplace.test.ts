import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness, githubSource } from "./helpers/harness.js";

describe("marketplace add/remove (global registry, no --module)", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("registers a marketplace in the global registry", async () => {
    const result = await h.run(["marketplace", "add", "owner/repo", "--name", "mp"]);

    expect(result.code).toBe(0);
    const registry = JSON.parse(await h.readFileAt("settings.json", h.modulesHome));
    expect(registry.marketplaces.mp).toEqual(githubSource("owner/repo"));
  });

  it("infers the name from the spec when --source is given without --name, same as without --source", async () => {
    const result = await h.run(["marketplace", "add", "owner/repo", "--source", JSON.stringify(githubSource("owner/repo"))]);

    expect(result.code).toBe(0);
    const registry = JSON.parse(await h.readFileAt("settings.json", h.modulesHome));
    expect(registry.marketplaces.repo).toEqual(githubSource("owner/repo"));
    expect(registry.marketplaces["owner/repo"]).toBeUndefined();
  });

  it("still honors --name over inference when --source is given", async () => {
    const result = await h.run([
      "marketplace",
      "add",
      "owner/repo",
      "--name",
      "mp",
      "--source",
      JSON.stringify(githubSource("owner/repo")),
    ]);

    expect(result.code).toBe(0);
    const registry = JSON.parse(await h.readFileAt("settings.json", h.modulesHome));
    expect(registry.marketplaces.mp).toEqual(githubSource("owner/repo"));
    expect(registry.marketplaces.repo).toBeUndefined();
  });

  it("registers an @ref-pinned marketplace, storing the ref verbatim", async () => {
    const result = await h.run(["marketplace", "add", "owner/repo@v2.0", "--name", "mp"]);

    expect(result.code).toBe(0);
    const registry = JSON.parse(await h.readFileAt("settings.json", h.modulesHome));
    expect(registry.marketplaces.mp).toEqual(githubSource("owner/repo@v2.0"));
  });

  it("infers the name from an @ref-pinned spec, excluding the ref", async () => {
    const result = await h.run(["marketplace", "add", "owner/repo@v2.0"]);

    expect(result.code).toBe(0);
    const registry = JSON.parse(await h.readFileAt("settings.json", h.modulesHome));
    expect(registry.marketplaces.repo).toEqual(githubSource("owner/repo@v2.0"));
    expect(registry.marketplaces["repo@v2.0"]).toBeUndefined();
  });

  it("infers the name from an @ref-pinned spec when --source is given without --name, excluding the ref", async () => {
    const result = await h.run([
      "marketplace",
      "add",
      "owner/repo@v2.0",
      "--source",
      JSON.stringify(githubSource("owner/repo@v2.0")),
    ]);

    expect(result.code).toBe(0);
    const registry = JSON.parse(await h.readFileAt("settings.json", h.modulesHome));
    expect(registry.marketplaces.repo).toEqual(githubSource("owner/repo@v2.0"));
    expect(registry.marketplaces["repo@v2.0"]).toBeUndefined();
  });

  it("does not warn about an unverified source for an @ref-pinned spec", async () => {
    const result = await h.run(["marketplace", "add", "owner/repo@v2.0", "--name", "mp"]);

    expect(result.code).toBe(0);
    expect(result.output).not.toContain("unverified against real Claude Code output");
  });

  it("still warns about an unverified source for a non-GitHub spec", async () => {
    const result = await h.run(["marketplace", "add", "./local/path", "--name", "mp"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("unverified against real Claude Code output");
  });

  it("fails with an error recommending '@ref' when shorthand is given a '#ref' fragment instead", async () => {
    const result = await h.run(["marketplace", "add", "owner/repo#v2.0"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("@ref");
    expect(result.stderr).toContain("owner/repo@v2.0");
  });

  it("fails with a clear error for malformed --source JSON, not a raw stack trace", async () => {
    const result = await h.run(["marketplace", "add", "owner/repo", "--source", "{ not valid json"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--source");
    expect(result.stderr).toContain("not valid JSON");
    expect(result.stderr).not.toContain("SyntaxError:");
  });

  it("falls back to the raw spec as the name when --source is given and the spec itself doesn't parse", async () => {
    // Exercises AddMarketplaceCommand's separate inferName() catch fallback: --source bypasses
    // auto-detection for the *source*, but the *name* still falls back to parseMarketplaceSpec(spec)
    // when --name isn't given — and here 'owner/repo#v2.0' is rejected by that parser (shorthand
    // doesn't support '#ref'), so the name falls back to the spec string verbatim.
    const result = await h.run([
      "marketplace",
      "add",
      "owner/repo#v2.0",
      "--source",
      JSON.stringify(githubSource("owner/repo")),
    ]);

    expect(result.code).toBe(0);
    const registry = JSON.parse(await h.readFileAt("settings.json", h.modulesHome));
    expect(registry.marketplaces["owner/repo#v2.0"]).toEqual(githubSource("owner/repo"));
  });

  it("reports what would happen under --dry-run with an explicit --source, without writing", async () => {
    const result = await h.run([
      "marketplace",
      "add",
      "owner/repo",
      "--source",
      JSON.stringify(githubSource("owner/repo")),
      "--dry-run",
    ]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("[dry-run]");
    const registryExists = await h
      .readFileAt("settings.json", h.modulesHome)
      .then(() => true)
      .catch(() => false);
    expect(registryExists).toBe(false);
  });

  it("removes a marketplace from the global registry", async () => {
    await h.run(["marketplace", "add", "owner/repo", "--name", "mp"]);

    const result = await h.run(["marketplace", "remove", "mp"]);

    expect(result.code).toBe(0);
    const registry = JSON.parse(await h.readFileAt("settings.json", h.modulesHome));
    expect(registry.marketplaces.mp).toBeUndefined();
  });

  it("warns rather than failing when removing an unregistered marketplace", async () => {
    const result = await h.run(["marketplace", "remove", "does-not-exist"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("is not registered; nothing to remove");
  });
});

describe("marketplace add/remove --module", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("demo", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("registers a marketplace onto the module's extraKnownMarketplaces, not the global registry", async () => {
    const result = await h.run(["marketplace", "add", "owner/repo", "--name", "mp", "--module", "demo"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("mp");
    expect(info.stdout).toContain(JSON.stringify(githubSource("owner/repo")));

    const registryExists = await h
      .readFileAt("settings.json", h.modulesHome)
      .then(() => true)
      .catch(() => false);
    expect(registryExists).toBe(false);
  });

  it("removes a marketplace from the module only", async () => {
    await h.writeModule("demo", {
      enabledPlugins: {},
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      composedModules: [],
    });

    const result = await h.run(["marketplace", "remove", "mp", "--module", "demo"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("no additional marketplaces known");
  });

  it("does not touch the global registry when adding onto a module", async () => {
    await h.run(["marketplace", "add", "global-mp", "--module", "demo"]);
    const globalGet = await h.run(["marketplace", "remove", "global-mp"]);
    expect(globalGet.output).toContain("is not registered; nothing to remove");
  });

  it("warns rather than failing when removing a marketplace not registered on the module", async () => {
    const result = await h.run(["marketplace", "remove", "does-not-exist", "--module", "demo"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("is not registered on module 'demo'; nothing to remove");
  });

  it("does not remove a marketplace only inherited via composition", async () => {
    await h.writeModule("base", {
      enabledPlugins: {},
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      composedModules: [],
    });
    await h.writeModule("child", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: ["base"] });

    const result = await h.run(["marketplace", "remove", "mp", "--module", "child"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("is not registered on module 'child'; nothing to remove");
    const info = await h.run(["info", "base"]);
    expect(info.stdout).toContain("mp");
  });

  it("fails with a clear error for a nonexistent module", async () => {
    const result = await h.run(["marketplace", "add", "owner/repo", "--module", "ghost"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ghost");
  });

  it("fails with a clear error for a nonexistent module on remove too", async () => {
    const result = await h.run(["marketplace", "remove", "mp", "--module", "ghost"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ghost");
  });

  it("reports what would happen under --dry-run without writing", async () => {
    const result = await h.run(["marketplace", "add", "owner/repo", "--name", "mp", "--module", "demo", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("[dry-run]");
    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("no additional marketplaces known");
  });

  it("bumps the module's patch version on add", async () => {
    await h.run(["marketplace", "add", "owner/repo", "--name", "mp", "--module", "demo"]);

    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("(v1.0.1)");
  });

  it("bumps the module's minor version on remove", async () => {
    await h.writeModule("demo", {
      enabledPlugins: {},
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      composedModules: [],
    });

    await h.run(["marketplace", "remove", "mp", "--module", "demo"]);

    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("(v1.1.0)");
  });

  it("does not bump the version on --dry-run or on the idempotent no-op remove path", async () => {
    await h.run(["marketplace", "add", "owner/repo", "--name", "mp", "--module", "demo", "--dry-run"]);
    await h.run(["marketplace", "remove", "does-not-exist", "--module", "demo"]);

    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("(v1.0.0)");
  });

  it("global marketplace add/remove (no --module) never bumps any module's version", async () => {
    await h.run(["marketplace", "add", "owner/repo", "--name", "global-mp"]);
    await h.run(["marketplace", "remove", "global-mp"]);

    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("(v1.0.0)");
  });
});

describe("marketplace list", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("reports an empty-state message when nothing is registered globally", async () => {
    const result = await h.run(["marketplace", "list"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No marketplaces registered");
  });

  it("lists every marketplace registered in the global registry", async () => {
    await h.run(["marketplace", "add", "owner/repo", "--name", "mp"]);
    await h.run(["marketplace", "add", "other/repo", "--name", "mp2"]);

    const result = await h.run(["marketplace", "list"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("mp");
    expect(result.stdout).toContain(JSON.stringify(githubSource("owner/repo")));
    expect(result.stdout).toContain("mp2");
    expect(result.stdout).toContain(JSON.stringify(githubSource("other/repo")));
  });

  it("reports an empty-state message for a module with no marketplaces of its own", async () => {
    await h.writeModule("demo", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });

    const result = await h.run(["marketplace", "list", "--module", "demo"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No marketplaces known to module 'demo'");
  });

  it("with --module, lists only that module's own marketplaces, not the global registry", async () => {
    await h.run(["marketplace", "add", "global-mp", "--name", "global-mp"]);
    await h.writeModule("demo", {
      enabledPlugins: {},
      extraKnownMarketplaces: { "module-mp": githubSource("owner/repo") },
      composedModules: [],
    });

    const result = await h.run(["marketplace", "list", "--module", "demo"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("module-mp");
    expect(result.stdout).not.toContain("global-mp");
  });

  it("does not surface a marketplace only inherited via composition", async () => {
    await h.writeModule("base", {
      enabledPlugins: {},
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      composedModules: [],
    });
    await h.writeModule("child", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: ["base"] });

    const result = await h.run(["marketplace", "list", "--module", "child"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No marketplaces known to module 'child'");
  });

  it("fails with a clear error for a nonexistent module", async () => {
    const result = await h.run(["marketplace", "list", "--module", "ghost"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ghost");
  });
});

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

  it("reports what would happen under --dry-run without writing", async () => {
    const result = await h.run(["marketplace", "add", "owner/repo", "--name", "mp", "--module", "demo", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("[dry-run]");
    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("no additional marketplaces known");
  });
});

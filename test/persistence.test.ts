import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness } from "./helpers/harness.js";

/**
 * One saved list per scope, each living with the thing it describes. Before the split, all
 * three shared a single `.claude-modules` found by walking up from the cwd, which meant saving
 * at one repo scope silently clobbered the other's list, and a user-scope save dropped a file
 * into whatever directory it ran from.
 */
describe("per-scope module lists", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("alpha", { enabledPlugins: { "a@mp": true }, extraKnownMarketplaces: {} });
    await h.writeModule("beta", { enabledPlugins: { "b@mp": true }, extraKnownMarketplaces: {} });
    await h.writeModule("gamma", { enabledPlugins: { "c@mp": true }, extraKnownMarketplaces: {} });
    await h.writeInstalledPlugins(["a@mp", "b@mp", "c@mp"]);
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it.each([
    ["user", "user.modules"],
    ["project", ".claude-modules"],
    ["local", ".claude-modules.local"],
  ])("--scope %s saves to %s", async (scope) => {
    await h.run(["enable", "alpha", "--scope", scope, "--save"]);

    expect(await h.readModuleList(scope as "user" | "project" | "local")).toBe("alpha\n");
  });

  it("keeps project and local lists separate — neither overwrites the other", async () => {
    await h.run(["enable", "alpha", "--scope", "project", "--save"]);
    await h.run(["enable", "beta", "--scope", "local", "--save"]);

    expect(await h.readModuleList("project")).toBe("alpha\n");
    expect(await h.readModuleList("local")).toBe("beta\n");
  });

  it("reloads each scope from its own list", async () => {
    await h.run(["enable", "alpha", "--scope", "project", "--save"]);
    await h.run(["enable", "beta", "--scope", "local", "--save"]);

    const project = await h.run(["reload", "--scope", "project"]);
    const local = await h.run(["reload", "--scope", "local"]);

    expect(project.code).toBe(0);
    expect(local.code).toBe(0);
    expect((await h.readSettings("project")).enabledPlugins).toEqual({ "a@mp": true });
    expect((await h.readSettings("local")).enabledPlugins).toEqual({ "b@mp": true });
  });

  it("saving at one scope leaves the other scopes' lists untouched", async () => {
    await h.run(["enable", "alpha", "--scope", "project", "--save"]);
    await h.run(["enable", "beta", "--scope", "local", "--save"]);
    await h.run(["enable", "gamma", "--scope", "user", "--save"]);

    expect(await h.readModuleList("project")).toBe("alpha\n");
    expect(await h.readModuleList("local")).toBe("beta\n");
    expect(await h.readModuleList("user")).toBe("gamma\n");
  });

  it("status compares each scope against its own list", async () => {
    await h.run(["enable", "alpha", "--scope", "project", "--save"]);
    await h.run(["enable", "beta", "--scope", "local", "--save"]);

    const local = await h.run(["status", "--scope", "local"]);

    // Must grade `local` against [beta], not against project's [alpha].
    expect(local.code).toBe(0);
    expect(local.stdout).toContain(".claude-modules.local");
    expect(local.stdout).toContain("beta");
  });

  it("an explicit --save=<path> still wins and resolves against cwd", async () => {
    await h.run(["enable", "alpha", "--save=custom.list"]);

    expect(await h.readFileAt("custom.list")).toBe("alpha\n");
    expect(await h.moduleListExists("local")).toBe(false);
  });

  it("a custom path round-trips through reload --file", async () => {
    await h.run(["enable", "alpha", "--save=custom.list"]);

    const result = await h.run(["reload", "--file", "custom.list"]);

    expect(result.code).toBe(0);
    expect((await h.readSettings("local")).enabledPlugins).toEqual({ "a@mp": true });
  });

  it("bare reload does not find a custom path — --file is the only way back", async () => {
    // Documented in `enable --help`: bare reload consults the per-scope locations only.
    await h.run(["enable", "alpha", "--save=custom.list"]);

    const result = await h.run(["reload"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No module list found for local scope");
  });

  it("writes no list at all without --save", async () => {
    await h.run(["enable", "alpha"]);

    expect(await h.moduleListExists("local")).toBe(false);
  });

  it("writes nothing under --dry-run but names the target", async () => {
    const result = await h.run(["enable", "alpha", "--scope", "user", "--save", "--dry-run"]);

    expect(result.stdout).toContain("user.modules");
    expect(await h.moduleListExists("user")).toBe(false);
  });
});

/**
 * `.claude-modules` belongs to `project` and nothing else. Each scope reads only its own file —
 * there is no cross-scope fallback, so a list can never be applied at a scope it wasn't written for.
 */
describe("scopes never read each other's lists", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("alpha", { enabledPlugins: { "a@mp": true }, extraKnownMarketplaces: {} });
    await h.writeInstalledPlugins(["a@mp"]);
    await h.writeFileAt(".claude-modules", "alpha\n");
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("reads .claude-modules at project scope", async () => {
    const result = await h.run(["reload", "--scope", "project"]);

    expect(result.code).toBe(0);
    expect((await h.readSettings("project")).enabledPlugins).toEqual({ "a@mp": true });
  });

  it.each(["local", "user"])("does not read project's list at %s scope", async (scope) => {
    const result = await h.run(["reload", "--scope", scope]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`No module list found for ${scope} scope`);
  });

  it("status at local scope has nothing to compare against", async () => {
    await h.writeSettings("local", { enabledPlugins: { "a@mp": true } });

    const result = await h.run(["status"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No module list found for local scope");
  });
});

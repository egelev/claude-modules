import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness, githubSource } from "./helpers/harness.js";

describe("list", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("reports an empty-state message when there are no modules", async () => {
    const result = await h.run(["list"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No modules found. Create one with 'claude-modules create <name>'.");
  });

  it("lists a module with its enabled-plugin and marketplace counts", async () => {
    await h.writeModule("backend", {
      enabledPlugins: { "a@mp": true, "b@mp": false },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      composedModules: [],
    });

    const result = await h.run(["list"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("backend");
    expect(result.stdout).toContain("1 plugin(s) enabled");
    expect(result.stdout).toContain("1 marketplace(s)");
  });

  it("shows the module's recorded version", async () => {
    await h.writeModule("backend", { version: "2.3.4", enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });

    const result = await h.run(["list"]);

    expect(result.stdout).toContain("(v2.3.4)");
  });

  it("lists every module, each on its own line", async () => {
    await h.writeModule("backend", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });
    await h.writeModule("frontend", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });

    const result = await h.run(["list"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("backend");
    expect(result.stdout).toContain("frontend");
  });

  it("counts only a module's own plugins/marketplaces, not ones it composes in", async () => {
    await h.writeModule("base", {
      enabledPlugins: { "a@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      composedModules: [],
    });
    await h.writeModule("child", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: ["base"] });

    const result = await h.run(["list"]);

    const childLine = result.stdout.split("\n").find((line) => line.includes("child"));
    expect(childLine).toContain("0 plugin(s) enabled");
    expect(childLine).toContain("0 marketplace(s)");
  });
});

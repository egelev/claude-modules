import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness, githubSource } from "./helpers/harness.js";

describe("info", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("reports empty-state lines for a module with no plugins or marketplaces", async () => {
    await h.writeModule("demo", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });

    const result = await h.run(["info", "demo"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("no plugins enabled");
    expect(result.stdout).toContain("no additional marketplaces known");
  });

  it("shows the module's recorded version", async () => {
    await h.writeModule("demo", { version: "3.1.4", enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });

    const result = await h.run(["info", "demo"]);

    expect(result.stdout).toContain("(v3.1.4)");
  });

  it("defaults to version 1.0.0 for a legacy module with no recorded version", async () => {
    await h.writeModule("demo", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });

    const result = await h.run(["info", "demo"]);

    expect(result.stdout).toContain("(v1.0.0)");
  });

  it("renders enabled and disabled plugins distinctly", async () => {
    await h.writeModule("demo", {
      enabledPlugins: { "a@mp": true, "b@mp": false },
      extraKnownMarketplaces: {},
      composedModules: [],
    });

    const result = await h.run(["info", "demo"]);

    expect(result.stdout).toContain("a@mp (enabled)");
    expect(result.stdout).toContain("b@mp (disabled)");
  });

  it("renders a marketplace's raw source JSON", async () => {
    await h.writeModule("demo", {
      enabledPlugins: {},
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      composedModules: [],
    });

    const result = await h.run(["info", "demo"]);

    expect(result.stdout).toContain(JSON.stringify(githubSource("owner/repo")));
  });

  it("shows a composed-modules block only when composedModules is non-empty", async () => {
    await h.writeModule("base", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });
    await h.writeModule("child", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: ["base"] });

    const baseResult = await h.run(["info", "base"]);
    const childResult = await h.run(["info", "child"]);

    expect(baseResult.stdout).not.toContain("composes");
    expect(childResult.stdout).toContain("composes 1 module(s)");
    expect(childResult.stdout).toContain("base");
  });

  it("fails with a clear error for a nonexistent module", async () => {
    const result = await h.run(["info", "ghost"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ghost");
  });

  it("fails with a clear error for a corrupted module file, not a raw stack trace", async () => {
    await h.writeFileAt("modules/demo/settings.json", "{ not valid json", h.modulesHome);

    const result = await h.run(["info", "demo"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("demo");
    expect(result.stderr).toContain("not valid JSON");
    // A leaked raw stack trace starts with the error's name and has indented "at <file>:<line>"
    // frames — distinct from V8's own SyntaxError message text, which can itself legitimately
    // contain the word "at" (e.g. "... in JSON at position 1") without being a stack trace.
    expect(result.stderr).not.toContain("SyntaxError:");
    expect(result.stderr).not.toMatch(/at .*ModuleStore\.ts:\d+/);
  });

  it("fails with a clear error when a hand-edited composedModules isn't an array of strings", async () => {
    // Valid JSON, wrong shape — distinct from the corrupted-JSON case above. A hand-edited
    // `"composedModules": "base"` (string, not array) must surface as a clean error, not get
    // silently accepted and produce bizarre downstream behavior (.includes matching substrings,
    // spreading the string into individual characters as "module names").
    await h.writeFileAt(
      "modules/demo/settings.json",
      JSON.stringify({ enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: "base" }),
      h.modulesHome
    );

    const result = await h.run(["info", "demo"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("demo");
    expect(result.stderr).toContain("composedModules");
    expect(result.stderr).toContain("array of strings");
  });
});

import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness, githubSource } from "./helpers/harness.js";

describe("create", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("creates an empty module", async () => {
    const result = await h.run(["create", "backend"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "backend"]);
    expect(info.stdout).toContain("no plugins enabled");
  });

  it("refuses to overwrite an existing module", async () => {
    await h.run(["create", "backend"]);

    const result = await h.run(["create", "backend"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("already exists");
  });

  it("rejects a name that could escape the modules directory", async () => {
    const result = await h.run(["create", "../escape"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid module name");
  });

  it("writes nothing under --dry-run", async () => {
    const result = await h.run(["create", "backend", "--dry-run"]);

    expect(result.code).toBe(0);
    expect((await h.run(["list"])).stdout).toContain("No modules found");
  });

  it("ignores a stray directory under modules/ that has no settings.json", async () => {
    await mkdir(join(h.modulesHome, "modules", "junk"), { recursive: true });

    const result = await h.run(["list"]);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("junk");
  });
});

describe("create --from-scope", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeSettings("local", {
      enabledPlugins: {
        "jdtls@mp": true,
        "quarkus@mp": true,
        "suppressed@mp": false,
      },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      theme: "light",
    });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("captures the enabled plugins and marketplaces from a scope", async () => {
    const result = await h.run(["create", "backend", "--from-scope", "local"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "backend"]);
    expect(info.stdout).toContain("jdtls@mp");
    expect(info.stdout).toContain("quarkus@mp");
    expect(info.stdout).toContain("mp");
  });

  it("skips explicit-false entries — those are overrides, not members of the set", async () => {
    await h.run(["create", "backend", "--from-scope", "local"]);

    const info = await h.run(["info", "backend"]);
    expect(info.stdout).not.toContain("suppressed@mp");
    expect(info.stdout).toContain("2 plugin(s)");
  });

  it("does not capture unrelated settings keys", async () => {
    await h.run(["create", "backend", "--from-scope", "local"]);

    const info = await h.run(["info", "backend"]);
    expect(info.stdout).not.toContain("theme");
  });

  it("round-trips: a captured module re-applies to the same settings", async () => {
    await h.writeInstalledPlugins(["jdtls@mp", "quarkus@mp"]);
    await h.run(["create", "backend", "--from-scope", "local"]);

    const result = await h.run(["enable", "backend"]);

    expect(result.code).toBe(0);
    const settings = await h.readSettings("local");
    expect(settings.enabledPlugins).toEqual({
      "jdtls@mp": true,
      "quarkus@mp": true,
      // Retained as an explicit override, exactly as it was before the round trip.
      "suppressed@mp": false,
    });
    expect(settings.theme).toBe("light");
  });

  it("warns when the scope has nothing enabled", async () => {
    await h.writeSettings("project", { enabledPlugins: {} });

    const result = await h.run(["create", "empty", "--from-scope", "project"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("No plugins were enabled in project scope");
  });

  it("rejects an invalid scope", async () => {
    const result = await h.run(["create", "backend", "--from-scope", "galaxy"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid --scope 'galaxy'");
  });

  it("warns when it captures a marketplace that won't travel to another machine", async () => {
    await h.writeSettings("project", {
      enabledPlugins: { "a@local-mp": true },
      extraKnownMarketplaces: { "local-mp": { source: { source: "local", path: "/home/someone/plugins" } } },
    });

    const result = await h.run(["create", "captured", "--from-scope", "project"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("machine-specific");
  });

  it("does not warn for a portable github marketplace", async () => {
    const result = await h.run(["create", "backend", "--from-scope", "local"]);

    expect(result.stderr).not.toContain("machine-specific");
  });

  it("does not modify the scope it read from", async () => {
    const before = await h.readSettings("local");

    await h.run(["create", "backend", "--from-scope", "local"]);

    expect(await h.readSettings("local")).toEqual(before);
  });

  it("writes no module under --dry-run but still reports the counts", async () => {
    const result = await h.run(["create", "backend", "--from-scope", "local", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("2 plugin(s)");
    expect((await h.run(["list"])).stdout).toContain("No modules found");
  });
});

describe("create --compose", () => {
  let h: Harness;

  async function moduleDirExists(name: string): Promise<boolean> {
    const entries = await readdir(join(h.modulesHome, "modules")).catch((err) => {
      if (err.code === "ENOENT") return [] as string[];
      throw err;
    });
    return entries.includes(name);
  }

  beforeEach(async () => {
    h = await Harness.create();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("sets composedModules and inherits the composed module's plugins", async () => {
    await h.run(["create", "base"]);
    await h.run(["plugin", "install", "base-plugin@mp", "--module", "base", "--source", JSON.stringify(githubSource("owner/repo"))]);

    const result = await h.run(["create", "frontend", "--compose", "base"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "frontend"]);
    expect(info.stdout).toContain("composes 1 module(s)");
    expect(info.stdout).toContain("base");
  });

  it("is combinable with --from-scope", async () => {
    await h.run(["create", "base"]);
    await h.writeSettings("local", {
      enabledPlugins: { "local-plugin@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
    });

    const result = await h.run(["create", "frontend", "--compose", "base", "--from-scope", "local"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "frontend"]);
    expect(info.stdout).toContain("composes 1 module(s)");
    expect(info.stdout).toContain("local-plugin@mp");
  });

  it("rejects self-reference before writing anything", async () => {
    const result = await h.run(["create", "a", "--compose", "a"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Composition cycle detected");
    expect(await moduleDirExists("a")).toBe(false);
  });

  it("rejects a missing --compose target before writing anything", async () => {
    const result = await h.run(["create", "a", "--compose", "does-not-exist"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("does not exist");
    expect(await moduleDirExists("a")).toBe(false);
  });

  it("rejects a cycle before writing anything", async () => {
    await h.writeModule("q", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: ["p"] });

    const result = await h.run(["create", "p", "--compose", "q"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Composition cycle detected");
    expect(await moduleDirExists("p")).toBe(false);
  });

  it("rejects an unresolvable sibling marketplace conflict before writing anything", async () => {
    await h.writeModule("b", {
      enabledPlugins: {},
      extraKnownMarketplaces: { mp: githubSource("owner/b-repo") },
      composedModules: [],
    });
    await h.writeModule("c", {
      enabledPlugins: {},
      extraKnownMarketplaces: { mp: githubSource("owner/c-repo") },
      composedModules: [],
    });

    const result = await h.run(["create", "a", "--compose", "b", "--compose", "c"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("different sources");
    expect(await moduleDirExists("a")).toBe(false);
  });

  it("writes nothing under --dry-run but still validates the composition", async () => {
    await h.run(["create", "base"]);

    const result = await h.run(["create", "frontend", "--compose", "base", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("1 composed module(s)");
    expect(await moduleDirExists("frontend")).toBe(false);
  });
});

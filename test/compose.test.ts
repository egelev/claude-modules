import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness, githubSource } from "./helpers/harness.js";

describe("compose add", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.run(["create", "top"]);
    await h.run(["create", "base1"]);
    await h.run(["create", "base2"]);
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("adds a single composed module", async () => {
    const result = await h.run(["compose", "add", "top", "base1"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("composes 1 module(s)");
    expect(info.stdout).toContain("base1");
  });

  it("adds multiple composed modules in one call", async () => {
    const result = await h.run(["compose", "add", "top", "base1", "base2"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("composes 2 module(s)");
    expect(info.stdout).toContain("base1");
    expect(info.stdout).toContain("base2");
  });

  it("inherited plugins/marketplaces from a newly-composed module show up via enable", async () => {
    await h.run([
      "plugin",
      "install",
      "base1",
      "core@mp",
      "--source",
      JSON.stringify(githubSource("owner/repo")),
    ]);
    await h.run(["compose", "add", "top", "base1"]);
    await h.writeInstalledPlugins(["core@mp"]);

    const result = await h.run(["enable", "top"]);

    expect(result.code).toBe(0);
    const settings = await h.readSettings("local");
    expect(settings.enabledPlugins).toEqual({ "core@mp": true });
  });

  it("bumps the module's patch version on a successful add", async () => {
    await h.run(["compose", "add", "top", "base1"]);

    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("(v1.0.1)");
  });

  it("bumps the version exactly once even when adding multiple modules in one call", async () => {
    await h.run(["compose", "add", "top", "base1", "base2"]);

    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("(v1.0.1)");
  });

  it("is idempotent when every named module is already composed: warns, no bump, no write", async () => {
    await h.run(["compose", "add", "top", "base1"]);

    const result = await h.run(["compose", "add", "top", "base1"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("already composes");
    expect(result.output).toContain("nothing to add");
    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("(v1.0.1)");
    expect(info.stdout).toContain("composes 1 module(s)");
  });

  it("adds only the new names from a mix of new and already-composed, bumping once", async () => {
    await h.run(["compose", "add", "top", "base1"]);

    const result = await h.run(["compose", "add", "top", "base1", "base2"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("already composed, skipped: base1");
    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("composes 2 module(s)");
    expect(info.stdout).toContain("(v1.0.2)");
  });

  it("rejects self-reference atomically — nothing written", async () => {
    const result = await h.run(["compose", "add", "top", "top"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Composition cycle detected");
    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("no plugins enabled");
    expect(info.stdout).toContain("(v1.0.0)");
  });

  it("rejects a cycle atomically — nothing written", async () => {
    await h.writeModule("q", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: ["top"] });

    const result = await h.run(["compose", "add", "top", "q"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Composition cycle detected");
    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("(v1.0.0)");
  });

  it("rejects a missing composed target atomically — nothing written", async () => {
    const result = await h.run(["compose", "add", "top", "does-not-exist"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("does not exist");
    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("(v1.0.0)");
  });

  it("rejects an unresolvable sibling marketplace conflict atomically — nothing written", async () => {
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

    const result = await h.run(["compose", "add", "top", "b", "c"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("different sources");
    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("no plugins enabled");
    expect(info.stdout).toContain("(v1.0.0)");
  });

  it("fails with a clear error for a nonexistent target module", async () => {
    const result = await h.run(["compose", "add", "ghost", "base1"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ghost");
  });

  it("writes nothing under --dry-run", async () => {
    const result = await h.run(["compose", "add", "top", "base1", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("[dry-run]");
    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("no plugins enabled");
    expect(info.stdout).toContain("(v1.0.0)");
  });

  it("requires at least one composed module", async () => {
    const result = await h.run(["compose", "add", "top"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("at least one composed module");
  });
});

describe("compose remove", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.run(["create", "base1"]);
    await h.run(["create", "base2"]);
    await h.writeModule("top", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: ["base1", "base2"] });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("removes a single composed module", async () => {
    const result = await h.run(["compose", "remove", "top", "base1"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("composes 1 module(s)");
    expect(info.stdout).toContain("base2");
    expect(info.stdout).not.toContain("base1");
  });

  it("removes multiple composed modules in one call", async () => {
    const result = await h.run(["compose", "remove", "top", "base1", "base2"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("no plugins enabled");
    expect(info.stdout).not.toContain("composes");
  });

  it("bumps the module's minor version and resets patch, from a legacy module with no recorded version", async () => {
    await h.run(["compose", "remove", "top", "base1"]);

    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("(v1.1.0)");
  });

  it("bumps the version exactly once even when removing multiple modules in one call", async () => {
    await h.run(["compose", "remove", "top", "base1", "base2"]);

    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("(v1.1.0)");
  });

  it("is idempotent when none of the named modules are currently composed: warns, no bump", async () => {
    const result = await h.run(["compose", "remove", "top", "not-composed"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("does not compose");
    expect(result.output).toContain("nothing to remove");
    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("(v1.0.0)");
    expect(info.stdout).toContain("composes 2 module(s)");
  });

  it("removes only the present names from a mix, bumping once", async () => {
    const result = await h.run(["compose", "remove", "top", "base1", "not-composed"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("not composed, skipped: not-composed");
    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("composes 1 module(s)");
    expect(info.stdout).toContain("(v1.1.0)");
  });

  it("fails with a clear error for a nonexistent target module", async () => {
    const result = await h.run(["compose", "remove", "ghost", "base1"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ghost");
  });

  it("writes nothing under --dry-run", async () => {
    const result = await h.run(["compose", "remove", "top", "base1", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("[dry-run]");
    const info = await h.run(["info", "top"]);
    expect(info.stdout).toContain("composes 2 module(s)");
    expect(info.stdout).toContain("(v1.0.0)");
  });

  it("requires at least one composed module", async () => {
    const result = await h.run(["compose", "remove", "top"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("at least one composed module");
  });
});

describe("compose add/remove interaction with export/import", () => {
  let source: Harness;
  let dest: Harness;

  beforeEach(async () => {
    source = await Harness.create();
    dest = await Harness.create();
  });

  afterEach(async () => {
    await source.cleanup();
    await dest.cleanup();
  });

  it("a module composed via 'compose add' round-trips through export/import", async () => {
    await source.run(["create", "top"]);
    await source.run(["create", "base"]);
    await source.run(["compose", "add", "top", "base"]);
    const archivePath = `${source.root}/archive.tar.gz`;
    await source.run(["export", "top", "--output", archivePath]);

    const result = await dest.run(["import", archivePath]);

    expect(result.code).toBe(0);
    const info = await dest.run(["info", "top"]);
    expect(info.stdout).toContain("composes 1 module(s)");
    expect(info.stdout).toContain("base");
    expect(info.stdout).toContain("(v1.0.1)");
  });
});

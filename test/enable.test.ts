import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness, githubSource } from "./helpers/harness.js";

describe("enable", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("backend", {
      enabledPlugins: { "jdtls@mp": true, "quarkus@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
    });
    await h.writeModule("frontend", {
      enabledPlugins: { "playwright@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
    });
    await h.writeModule("conflicting", {
      enabledPlugins: { "x@mp": true },
      extraKnownMarketplaces: { mp: githubSource("someone-else/repo") },
    });
    await h.writeInstalledPlugins(["jdtls@mp", "quarkus@mp", "playwright@mp", "inherited@mp", "x@mp"]);
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("unions multiple modules — the full-stack case", async () => {
    const result = await h.run(["enable", "backend", "frontend"]);

    expect(result.code).toBe(0);
    const settings = await h.readSettings("local");
    expect(settings.enabledPlugins).toEqual({
      "jdtls@mp": true,
      "quarkus@mp": true,
      "playwright@mp": true,
    });
  });

  it("merges by default: a later 'enable' for a different module adds to what's already active", async () => {
    await h.run(["enable", "backend"]);

    const result = await h.run(["enable", "frontend"]);

    expect(result.code).toBe(0);
    const settings = await h.readSettings("local");
    expect(settings.enabledPlugins).toEqual({
      "jdtls@mp": true,
      "quarkus@mp": true,
      "playwright@mp": true,
    });
  });

  it("copies the union's marketplaces into the target scope", async () => {
    await h.run(["enable", "backend"]);

    const settings = await h.readSettings("local");
    expect(settings.extraKnownMarketplaces).toEqual({ mp: githubSource("owner/repo") });
  });

  it("fails when two modules declare the same marketplace differently", async () => {
    const result = await h.run(["enable", "backend", "conflicting"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("declared with different sources");
  });

  it("writes nothing under --dry-run", async () => {
    const result = await h.run(["enable", "backend", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("[dry-run]");
    await expect(h.readSettings("local")).rejects.toThrow();
  });

  it("tells the user an open session needs /reload-plugins", async () => {
    // Without this, a settings change made from a second terminal looks like a no-op.
    const result = await h.run(["enable", "backend"]);

    expect(result.stdout).toContain("/reload-plugins");
  });

  it("omits the reload hint under --dry-run, since nothing changed", async () => {
    const result = await h.run(["enable", "backend", "--dry-run"]);

    expect(result.stdout).not.toContain("/reload-plugins");
  });

  it("preserves unrelated settings already in the file", async () => {
    await h.writeSettings("local", { theme: "light", permissions: { allow: ["Read"] } });

    await h.run(["enable", "backend"]);

    const settings = await h.readSettings("local");
    expect(settings.theme).toBe("light");
    expect(settings.permissions).toEqual({ allow: ["Read"] });
  });

  it("targets the project scope with --scope project", async () => {
    await h.run(["enable", "backend", "--scope", "project"]);

    const settings = await h.readSettings("project");
    expect(settings.enabledPlugins).toHaveProperty("jdtls@mp", true);
  });

  it("rejects an unknown scope", async () => {
    const result = await h.run(["enable", "backend", "--scope", "galaxy"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid --scope 'galaxy'");
  });

  it("defaults to local scope when --scope is omitted", async () => {
    const result = await h.run(["enable", "backend"]);

    expect(result.code).toBe(0);
    const settings = await h.readSettings("local");
    expect(settings.enabledPlugins).toHaveProperty("jdtls@mp", true);
    await expect(h.readSettings("project")).rejects.toThrow();
    await expect(h.readSettings("user")).rejects.toThrow();
  });

  it("errors on a module that doesn't exist", async () => {
    const result = await h.run(["enable", "nope"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Module 'nope' does not exist");
  });

  it("falls back to cwd for local scope outside a git repository", async () => {
    const result = await h.run(["enable", "backend"], h.nonRepoDir);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("No git repository found; using");
    const written = JSON.parse(await h.readFileAt(".claude/settings.local.json", h.nonRepoDir)) as {
      enabledPlugins?: Record<string, boolean>;
    };
    expect(written.enabledPlugins).toHaveProperty("jdtls@mp", true);
  });

  it("still requires a git repository for project scope", async () => {
    const result = await h.run(["enable", "backend", "--scope", "project"], h.nonRepoDir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--scope project requires a git repository");
  });
});

describe("enable --only", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("backend", {
      enabledPlugins: { "jdtls@mp": true },
      extraKnownMarketplaces: {},
    });
    await h.writeInstalledPlugins(["jdtls@mp", "inherited@mp"]);
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("overrides a plugin inherited from a broader scope, in the target scope's own file", async () => {
    await h.writeSettings("user", { enabledPlugins: { "inherited@mp": true } });

    const result = await h.run(["enable", "backend", "--only"]);

    expect(result.code).toBe(0);
    const local = await h.readSettings("local");
    expect(local.enabledPlugins).toEqual({ "jdtls@mp": true, "inherited@mp": false });
  });

  it("never writes the broader scope's own file", async () => {
    await h.writeSettings("user", { enabledPlugins: { "inherited@mp": true }, theme: "dark" });

    await h.run(["enable", "backend", "--only"]);

    const user = await h.readSettings("user");
    expect(user.enabledPlugins).toEqual({ "inherited@mp": true });
    expect(user.theme).toBe("dark");
  });

  it("does not override a broader-scope plugin that is part of the union", async () => {
    await h.writeSettings("user", { enabledPlugins: { "jdtls@mp": true } });

    await h.run(["enable", "backend", "--only"]);

    const local = await h.readSettings("local");
    expect(local.enabledPlugins).toEqual({ "jdtls@mp": true });
  });

  it("--only still applies exactly in user scope, even though there's no broader scope to override", async () => {
    const result = await h.run(["enable", "backend", "--scope", "user", "--only"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("'user' scope has no broader scope to override");
  });

  it("--only replaces within this scope too: a plugin from a module no longer named is turned off", async () => {
    await h.writeModule("other", { enabledPlugins: { "other@mp": true }, extraKnownMarketplaces: {} });
    await h.run(["enable", "other"]);

    const result = await h.run(["enable", "backend", "--only"]);

    expect(result.code).toBe(0);
    const local = await h.readSettings("local");
    expect(local.enabledPlugins).toEqual({ "other@mp": false, "jdtls@mp": true });
  });

  it("does not crash outside a git repository at the default (local) scope, and still writes local scope", async () => {
    const result = await h.run(["enable", "backend", "--only"], h.nonRepoDir);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("No git repository found here");
    expect(result.stderr).toContain("--scope user");
    const written = JSON.parse(await h.readFileAt(".claude/settings.local.json", h.nonRepoDir)) as {
      enabledPlugins?: Record<string, boolean>;
    };
    expect(written.enabledPlugins).toEqual({ "jdtls@mp": true });
  });
});

describe("enable --save", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("backend", { enabledPlugins: { "jdtls@mp": true }, extraKnownMarketplaces: {} });
    await h.writeInstalledPlugins(["jdtls@mp"]);
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("writes the module list to the repo root, not the cwd", async () => {
    const subdir = await h.writeFileAt("nested/deep/.keep", "");
    const nested = subdir.replace("/.keep", "");

    await h.run(["enable", "backend", "--save"], nested);

    // Anchored at the repo root so `reload` finds it from any subdirectory.
    expect(await h.readModuleList("local")).toBe("backend\n");
  });

  it("writes to an explicit --save=<path>, resolved against cwd", async () => {
    await h.run(["enable", "backend", "--save=custom.list"]);

    expect(await h.readFileAt("custom.list")).toBe("backend\n");
  });

  it("--save=<path> still merges against the scope's canonical list, not just this run's own names", async () => {
    await h.writeModule("frontend", { enabledPlugins: { "playwright@mp": true }, extraKnownMarketplaces: {} });
    await h.run(["enable", "backend", "--save"]); // canonical .claude-modules.local: "backend"

    await h.run(["enable", "frontend", "--save=custom.list"]);

    // The custom path gets the merge (canonical "backend" + this run's "frontend"), not just
    // "frontend" alone — and the canonical file itself is untouched, since this run saved elsewhere.
    expect(await h.readFileAt("custom.list")).toBe("backend\nfrontend\n");
    expect(await h.readModuleList("local")).toBe("backend\n");
  });

  it("merge-appends: a second 'enable --save' adds to the list rather than overwriting it", async () => {
    await h.writeModule("frontend", { enabledPlugins: { "playwright@mp": true }, extraKnownMarketplaces: {} });
    await h.run(["enable", "backend", "--save"]);

    await h.run(["enable", "frontend", "--save"]);

    expect(await h.readModuleList("local")).toBe("backend\nfrontend\n");
  });

  it("--only --save replaces the list rather than merging into it", async () => {
    await h.writeModule("frontend", { enabledPlugins: { "playwright@mp": true }, extraKnownMarketplaces: {} });
    await h.run(["enable", "backend", "--save"]);

    await h.run(["enable", "frontend", "--only", "--save"]);

    expect(await h.readModuleList("local")).toBe("frontend\n");
  });

  it("reports the resulting active module list even without --save", async () => {
    const result = await h.run(["enable", "backend"]);

    expect(result.stdout).toContain("Modules active in local scope: [backend]");
    expect(result.stdout).toContain("not saved");
  });
});

describe("enable --install", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("uncached", {
      enabledPlugins: { "uncached@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
    });
    // Deliberately left out of Claude Code's own cache, unlike every fixture above — this is what
    // exercises the "still not cached" path, which nothing else in this file reaches.
    await h.writeInstalledPlugins([]);
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("never shells out to claude without --install", async () => {
    const result = await h.run(["enable", "uncached"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Plugin(s) not cached by Claude Code:");
    expect(result.stdout).toContain("claude plugin install uncached@mp --scope user -y");
    expect(result.stdout).toContain("Run with --install");
    expect(result.output).not.toContain("installed it now");
    expect(result.output).not.toContain("Failed to install");
  });

  it("exits 2 when --install can't fix it because the marketplace is unknown to Claude Code", async () => {
    // With the marketplace unknown, the plugin-install path fails as before — and now the new
    // marketplace-add path also fires and fails for the same underlying reason (no real 'claude' on
    // PATH in this harness), so both failures show up together.
    const result = await h.run(["enable", "uncached", "--install"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("still not cached by Claude Code after --install");
    expect(result.stderr).toContain("isn't in its known_marketplaces.json either");
    expect(result.stderr).toContain("still not known to Claude Code after --install");
    expect(result.stderr).toContain("Failed to add marketplace");
  });

  it("exits 0 with --install when the only missing marketplace has a source this tool can't convert to a CLI spec", async () => {
    // Mirrors the "isn't a shape this tool can convert" fallback: an unconvertible source is
    // reported as missing, but must never gate the exit-2 failure since --install has nothing
    // actionable to retry for it.
    await h.writeModule("odd-source", {
      enabledPlugins: {},
      extraKnownMarketplaces: { odd: { nope: true } },
    });

    const result = await h.run(["enable", "odd-source", "--install"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("isn't a shape this tool can");
  });

  it("exits 2 when --install can't fix it because claude is unreachable", async () => {
    // The marketplace is known this time, so installOne proceeds past that check into runClaude —
    // which fails here because the harness's env never sets PATH (see test/verify.test.ts for the
    // same, already-established technique).
    await h.writeKnownMarketplaces({ mp: githubSource("owner/repo") });

    const result = await h.run(["enable", "uncached", "--install"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("'claude' not found on PATH");
  });

  it("exits 0 with --install when nothing ends up missing", async () => {
    await h.writeModule("backend", { enabledPlugins: { "jdtls@mp": true }, extraKnownMarketplaces: {} });
    await h.writeInstalledPlugins(["jdtls@mp"]);

    const result = await h.run(["enable", "backend", "--install"]);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("Plugin(s) not cached by Claude Code:");
  });

  it("suppresses the exit-2 failure under --dry-run, since nothing was actually attempted", async () => {
    const result = await h.run(["enable", "uncached", "--install", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("[dry-run]");
    expect(result.stdout).toContain("nothing was actually run");
    expect(result.stderr).not.toContain("Error:");
  });

  it("does not fail on an uncached plugin from a broader scope that this run didn't touch", async () => {
    // The exit-2 check must be scoped to this run's own union, not the whole report: a plugin left
    // uncached by some unrelated command, in a scope this module selection never mentions, isn't
    // this run's failure to report.
    await h.writeModule("cachedonly", { enabledPlugins: { "a@mp": true }, extraKnownMarketplaces: {} });
    await h.writeInstalledPlugins(["a@mp"]);
    await h.writeSettings("user", { enabledPlugins: { "other@mp": true } });

    const result = await h.run(["enable", "cachedonly", "--install"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Plugin(s) not cached by Claude Code:");
    expect(result.stdout).toContain("other@mp");
  });
});

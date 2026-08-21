import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InstallCommand } from "../src/cli/commands/InstallCommand.js";
import { InstalledPluginsCache } from "../src/core/InstalledPluginsCache.js";
import { KnownMarketplacesCache } from "../src/core/KnownMarketplacesCache.js";
import { MarketplaceRegistry } from "../src/core/MarketplaceRegistry.js";
import { ClaudeRunResult } from "../src/core/ClaudeRunner.js";
import { PluginCacheInstaller } from "../src/core/PluginCacheInstaller.js";
import { ModuleStore } from "../src/core/ModuleStore.js";
import { Logger, LogLevel } from "../src/util/Logger.js";
import { Paths } from "../src/util/Paths.js";
import { Harness, githubSource } from "./helpers/harness.js";

describe("plugin install", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("demo", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });
    // Pre-mark every plugin used below as already cached, so InstallCommand's cache-install step
    // never actually shells out to a real `claude` binary during these tests.
    await h.writeInstalledPlugins(["a@mp", "b@mp", "c@mp", "d@mp"]);
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("enables the plugin in the module", async () => {
    await h.writeKnownMarketplaces({ mp: { source: githubSource("owner/repo").source } });

    const result = await h.run(["plugin", "install", "demo", "a@mp"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("a@mp (enabled)");
  });

  it("resolves the marketplace from an explicit --source first", async () => {
    const result = await h.run([
      "plugin",
      "install",
      "demo",
      "b@mp",
      "--source",
      JSON.stringify(githubSource("explicit/repo")),
    ]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain(JSON.stringify(githubSource("explicit/repo")));
  });

  it("falls back to the global marketplace registry when no --source is given", async () => {
    await h.run(["marketplace", "add", "owner/repo", "--name", "mp"]);

    const result = await h.run(["plugin", "install", "demo", "c@mp"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain(JSON.stringify(githubSource("owner/repo")));
  });

  it("falls back to Claude Code's own known_marketplaces.json cache last", async () => {
    await h.writeKnownMarketplaces({ mp: { source: githubSource("cache/repo").source } });

    const result = await h.run(["plugin", "install", "demo", "d@mp"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain(JSON.stringify(githubSource("cache/repo")));
  });

  it("skips marketplace resolution entirely for a second plugin from a marketplace the module already knows", async () => {
    await h.run(["plugin", "install", "demo", "a@mp", "--source", JSON.stringify(githubSource("explicit/repo"))]);
    // Deliberately nothing registered globally and nothing in known_marketplaces.json for 'mp' — if
    // this second install re-resolved the marketplace instead of reusing what's already on the
    // module, it would fail with "Unknown marketplace 'mp'".

    const result = await h.run(["plugin", "install", "demo", "b@mp"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("b@mp (enabled)");
    expect(info.stdout).toContain(JSON.stringify(githubSource("explicit/repo")));
  });

  it("fails with a clear error when the marketplace can't be resolved anywhere", async () => {
    const result = await h.run(["plugin", "install", "demo", "a@unknown-mp"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown marketplace 'unknown-mp'");
  });

  it("writes nothing under --dry-run", async () => {
    await h.writeKnownMarketplaces({ mp: { source: githubSource("owner/repo").source } });

    const result = await h.run(["plugin", "install", "demo", "a@mp", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("[dry-run]");
    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("no plugins enabled");
  });

  it("bumps the module's patch version", async () => {
    await h.writeKnownMarketplaces({ mp: { source: githubSource("owner/repo").source } });

    await h.run(["plugin", "install", "demo", "a@mp"]);

    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("(v1.0.1)");
  });

  it("bumps the patch version only once even though it also records a resolved marketplace", async () => {
    await h.run(["marketplace", "add", "owner/repo", "--name", "mp"]);

    await h.run(["plugin", "install", "demo", "c@mp"]);

    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("(v1.0.1)");
  });

  it("leaves the version untouched under --dry-run", async () => {
    await h.writeKnownMarketplaces({ mp: { source: githubSource("owner/repo").source } });

    await h.run(["plugin", "install", "demo", "a@mp", "--dry-run"]);

    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("(v1.0.0)");
  });

  it("requires both a module name and a plugin key", async () => {
    const result = await h.run(["plugin", "install", "demo"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("plugin install requires <module> <plugin>@<marketplace>");
  });

  it("ignores extra positionals beyond <module> <plugin>@<marketplace>", async () => {
    await h.writeKnownMarketplaces({ mp: { source: githubSource("owner/repo").source } });

    const result = await h.run(["plugin", "install", "demo", "a@mp", "extra-arg"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("a@mp (enabled)");
  });

  it("fails with a clear error for malformed --source JSON, not a raw stack trace", async () => {
    const result = await h.run(["plugin", "install", "demo", "a@mp", "--source", "{ not valid json"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--source");
    expect(result.stderr).toContain("not valid JSON");
    expect(result.stderr).not.toContain("SyntaxError:");
  });

  it("is idempotent: warns rather than churning the version when the plugin is already enabled", async () => {
    await h.writeKnownMarketplaces({ mp: { source: githubSource("owner/repo").source } });
    await h.run(["plugin", "install", "demo", "a@mp"]);

    const result = await h.run(["plugin", "install", "demo", "a@mp"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("is already enabled in module 'demo'; nothing to do");
    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("(v1.0.1)");
  });

  it("rejects the old --module flag as an unknown option, rather than silently ignoring it", async () => {
    const result = await h.run(["plugin", "install", "demo", "a@mp", "--module", "demo"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown option '--module'");
  });
});

describe("plugin uninstall", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("demo", {
      enabledPlugins: { "a@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      composedModules: [],
    });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("disables the plugin in the module", async () => {
    const result = await h.run(["plugin", "uninstall", "demo", "a@mp"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("no plugins enabled");
  });

  it("never removes the plugin's marketplace from extraKnownMarketplaces", async () => {
    await h.run(["plugin", "uninstall", "demo", "a@mp"]);

    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain(JSON.stringify(githubSource("owner/repo")));
  });

  it("is idempotent: warns rather than failing when the plugin isn't enabled", async () => {
    const result = await h.run(["plugin", "uninstall", "demo", "never-enabled@mp"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("is not enabled in module 'demo'; nothing to do");
  });

  it("writes nothing under --dry-run", async () => {
    const result = await h.run(["plugin", "uninstall", "demo", "a@mp", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("[dry-run]");
    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("a@mp (enabled)");
  });

  it("bumps the module's minor version and resets patch, even from a legacy module with no recorded version", async () => {
    // `demo` is written directly via writeModule with no `version` key — the pre-versioning shape —
    // so this also exercises the normalizeModule() backward-compat default (absent -> "1.0.0").
    await h.run(["plugin", "uninstall", "demo", "a@mp"]);

    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("(v1.1.0)");
  });

  it("does not bump the version on the idempotent no-op path", async () => {
    await h.run(["plugin", "uninstall", "demo", "never-enabled@mp"]);

    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("(v1.0.0)");
  });

  it("leaves the version untouched under --dry-run", async () => {
    await h.run(["plugin", "uninstall", "demo", "a@mp", "--dry-run"]);

    const info = await h.run(["info", "demo"]);
    expect(info.stdout).toContain("(v1.0.0)");
  });

  it("requires both a module name and a plugin key", async () => {
    const result = await h.run(["plugin", "uninstall", "demo"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("plugin uninstall requires <module> <plugin>@<marketplace>");
  });
});

describe("plugin uninstall --disable", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("base", {
      enabledPlugins: { "a@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      composedModules: [],
    });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("sets the key to false instead of deleting it", async () => {
    const result = await h.run(["plugin", "uninstall", "base", "a@mp", "--disable"]);

    expect(result.code).toBe(0);
    const info = await h.run(["info", "base"]);
    expect(info.stdout).toContain("a@mp (disabled)");
  });

  it("overrides a plugin the module composes in, unlike a plain uninstall", async () => {
    await h.writeModule("child", {
      enabledPlugins: { "a@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
      composedModules: [],
    });
    await h.writeModule("parent", {
      enabledPlugins: {},
      extraKnownMarketplaces: {},
      composedModules: ["child"],
    });
    // Baseline: composing 'child' with no override enables a@mp.
    await h.run(["enable", "child"]);
    expect((await h.readSettings("local")).enabledPlugins).toEqual({ "a@mp": true });

    await h.run(["plugin", "uninstall", "parent", "a@mp", "--disable"]);
    // --only forces this scope to match 'parent' exactly, which is what surfaces the override as an
    // explicit false — plain (merge) enable would just leave the prior true from 'child' untouched,
    // since parent's own union no longer contributes a@mp at all rather than actively turning it off.
    const result = await h.run(["enable", "parent", "--only"]);

    expect(result.code).toBe(0);
    const settings = await h.readSettings("local");
    expect(settings.enabledPlugins).toEqual({ "a@mp": false });
  });

  it("writes nothing under --dry-run", async () => {
    const result = await h.run(["plugin", "uninstall", "base", "a@mp", "--disable", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("[dry-run]");
    const info = await h.run(["info", "base"]);
    expect(info.stdout).toContain("a@mp (enabled)");
  });

  it("bumps the minor version, same as a plain uninstall", async () => {
    await h.run(["plugin", "uninstall", "base", "a@mp", "--disable"]);

    const info = await h.run(["info", "base"]);
    expect(info.stdout).toContain("(v1.1.0)");
  });
});

describe("plugin install's cache-warming neutralizes its own user-scope enablement", () => {
  // Regression coverage for the audit's item 4: `plugin install` has no real target scope of its
  // own, so its cache-warming shell-out always installs at 'user' — which durably *enables* the
  // plugin there, not just caches it. It must immediately neutralize that with a follow-up 'claude
  // plugin disable --scope user', but only for a plugin it actually just installed — never for one
  // that was already cached, and never under --dry-run. Harness/Cli always wire up the real
  // defaultClaudeRunner (no real `claude` binary in this suite), so this constructs InstallCommand
  // directly with a fake ClaudeRunner, the same seam test/applyModulesUseCase.test.ts uses.
  let h: Harness;
  let paths: Paths;
  let runs: string[][];

  function build(result: ClaudeRunResult = { ok: true, stdout: "" }, dryRun = false): InstallCommand {
    const logger = new Logger(LogLevel.ERROR);
    const runClaude = async (args: string[]) => {
      runs.push(args);
      return result;
    };
    const knownMarketplacesCache = new KnownMarketplacesCache(paths);
    const installedPluginsCache = new InstalledPluginsCache(paths);
    const pluginCacheInstaller = new PluginCacheInstaller(
      knownMarketplacesCache,
      installedPluginsCache,
      logger,
      {},
      runClaude
    );
    return new InstallCommand(
      "a@mp",
      "demo",
      undefined,
      new ModuleStore(paths),
      new MarketplaceRegistry(paths),
      knownMarketplacesCache,
      pluginCacheInstaller,
      logger,
      dryRun
    );
  }

  beforeEach(async () => {
    h = await Harness.create();
    paths = new Paths(h.env);
    runs = [];
    await h.writeModule("demo", { enabledPlugins: {}, extraKnownMarketplaces: {}, composedModules: [] });
    await h.writeKnownMarketplaces({ mp: { source: githubSource("owner/repo").source } });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("disables the plugin at user scope right after installing it into the cache", async () => {
    await h.writeInstalledPlugins([]);

    await build().execute();

    expect(runs).toEqual([
      ["plugin", "install", "a@mp", "--scope", "user", "-y"],
      ["plugin", "disable", "a@mp", "--scope", "user"],
    ]);
  });

  it("does not run the neutralizing disable when the plugin was already cached", async () => {
    await h.writeInstalledPlugins(["a@mp"]);

    await build().execute();

    expect(runs).toEqual([]);
  });

  it("does not run the neutralizing disable under --dry-run", async () => {
    await h.writeInstalledPlugins([]);

    await build({ ok: true, stdout: "" }, true).execute();

    expect(runs).toEqual([]);
  });

  it("does not run the neutralizing disable when the install itself failed", async () => {
    await h.writeInstalledPlugins([]);

    await build({ ok: false, detail: "no network" }).execute();

    expect(runs).toEqual([["plugin", "install", "a@mp", "--scope", "user", "-y"]]);
  });
});

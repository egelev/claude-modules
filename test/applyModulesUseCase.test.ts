import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { ApplyModulesUseCase } from "../src/core/ApplyModulesUseCase.js";
import { EnabledPluginsReporter } from "../src/core/EnabledPluginsReporter.js";
import { InstalledPluginsCache } from "../src/core/InstalledPluginsCache.js";
import { KnownMarketplacesCache } from "../src/core/KnownMarketplacesCache.js";
import { MarketplaceCacheInstaller } from "../src/core/MarketplaceCacheInstaller.js";
import { ClaudeRunResult } from "../src/core/ClaudeRunner.js";
import { PluginCacheInstaller } from "../src/core/PluginCacheInstaller.js";
import { CompositionResolver } from "../src/core/CompositionResolver.js";
import { ModuleResolver } from "../src/core/ModuleResolver.js";
import { ModuleStore } from "../src/core/ModuleStore.js";
import { RepoLocator } from "../src/core/RepoLocator.js";
import { ScopeResolver } from "../src/core/ScopeResolver.js";
import { SettingsApplier } from "../src/core/SettingsApplier.js";
import { SettingsRepository } from "../src/core/SettingsRepository.js";
import { Scope } from "../src/core/types.js";
import { Logger, LogLevel } from "../src/util/Logger.js";
import { Paths } from "../src/util/Paths.js";
import { Harness, githubSource } from "./helpers/harness.js";

/**
 * Unit-tests ApplyModulesUseCase directly, bypassing Cli/parseArgs, the same way
 * test/pluginCache.test.ts isolates PluginCacheInstaller with a fake ClaudeRunner. This is the only
 * way to assert the installer *was* (or wasn't) actually invoked — Harness/Cli always wire up the
 * real defaultClaudeRunner, so an integration test can only observe outcomes reachable without a
 * real `claude` binary (see test/enable.test.ts's "enable --install" block for those).
 *
 * A fake runner returning { ok: true } never writes installed_plugins.json, so assertions here check
 * `runs` (the recorded call args) — never report.uncachedPluginKeys becoming empty, which would stay
 * populated regardless of what the fake runner returned.
 */
describe("ApplyModulesUseCase", () => {
  let h: Harness;
  let paths: Paths;
  let runs: string[][];

  function build(
    result: ClaudeRunResult = { ok: true, stdout: "" },
    // A fake runner returning { ok: true } never actually writes known_marketplaces.json — pass this
    // to simulate the real 'claude plugin marketplace add' side effect for ordering tests that need
    // the plugin-install step to see a marketplace this same run just "added".
    onRun?: (args: string[]) => Promise<void> | void
  ): ApplyModulesUseCase {
    const logger = new Logger(LogLevel.ERROR);
    const repoLocator = new RepoLocator();
    const scopeResolver = new ScopeResolver(repoLocator, paths, logger);
    const moduleStore = new ModuleStore(paths);
    const compositionResolver = new CompositionResolver(moduleStore);
    const moduleResolver = new ModuleResolver(compositionResolver, logger);
    const knownMarketplacesCache = new KnownMarketplacesCache(paths);
    const installedPluginsCache = new InstalledPluginsCache(paths);
    const runClaude = async (args: string[]) => {
      runs.push(args);
      await onRun?.(args);
      return result;
    };
    const marketplaceCacheInstaller = new MarketplaceCacheInstaller(knownMarketplacesCache, logger, {}, runClaude);
    const pluginCacheInstaller = new PluginCacheInstaller(
      knownMarketplacesCache,
      installedPluginsCache,
      logger,
      {},
      runClaude
    );
    const settingsRepository = new SettingsRepository();
    const settingsApplier = new SettingsApplier(logger);
    const enabledPluginsReporter = new EnabledPluginsReporter(
      scopeResolver,
      settingsRepository,
      installedPluginsCache,
      logger
    );
    return new ApplyModulesUseCase(
      scopeResolver,
      moduleResolver,
      settingsRepository,
      settingsApplier,
      marketplaceCacheInstaller,
      pluginCacheInstaller,
      enabledPluginsReporter,
      logger
    );
  }

  beforeEach(async () => {
    h = await Harness.create();
    paths = new Paths(h.env);
    runs = [];
    await h.writeModule("backend", {
      enabledPlugins: { "a@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
    });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("never invokes the runner when install is false, regardless of cache state", async () => {
    await h.writeInstalledPlugins([]);

    await build().run(["backend"], Scope.Local, h.repoRoot, false, false, false);

    expect(runs).toEqual([]);
  });

  it("invokes the runner with the expected args when install is true and the plugin is uncached", async () => {
    await h.writeInstalledPlugins([]);
    await h.writeKnownMarketplaces({ mp: githubSource("owner/repo") });

    await build().run(["backend"], Scope.Local, h.repoRoot, false, true, false);

    expect(runs).toEqual([["plugin", "install", "a@mp", "--scope", "local", "-y"]]);
  });

  it("threads the actual target scope through to the shell-out, not a hardcoded 'user'", async () => {
    // Regression test for the scope-leak this tool's own audit found: --install used to always shell
    // out with '--scope user' regardless of which scope the module was actually being applied to,
    // which durably enabled the plugin at the user's real global scope even for a project/local-only
    // module. The marketplace-add and plugin-install shell-outs must both land at the scope actually
    // being written here.
    await h.writeInstalledPlugins([]);
    const onRun = async (args: string[]) => {
      if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "add") {
        await h.writeKnownMarketplaces({ mp: githubSource("owner/repo") });
      }
    };

    await build({ ok: true, stdout: "" }, onRun).run(["backend"], Scope.Project, h.repoRoot, false, true, false);

    expect(runs).toEqual([
      ["plugin", "marketplace", "add", "owner/repo", "--scope", "project"],
      ["plugin", "install", "a@mp", "--scope", "project", "-y"],
    ]);
  });

  it("never invokes the runner when install is true but the plugin is already cached", async () => {
    await h.writeInstalledPlugins(["a@mp"]);
    // Isolates the plugin-already-cached case: without this, the new marketplace-add step would
    // itself fire (the marketplace is otherwise unknown) and populate `runs`.
    await h.writeKnownMarketplaces({ mp: githubSource("owner/repo") });

    await build().run(["backend"], Scope.Local, h.repoRoot, false, true, false);

    expect(runs).toEqual([]);
  });

  it("returns the resolved scope, report, and this run's own union of plugin keys", async () => {
    await h.writeInstalledPlugins([]);

    const result = await build().run(["backend"], Scope.Local, h.repoRoot, false, false, false);

    expect(result.resolvedScope.scope).toBe(Scope.Local);
    expect(result.report.uncachedPluginKeys).toEqual(["a@mp"]);
    expect(result.enabledPluginNames).toEqual(new Set(["a@mp"]));
  });

  it("invokes the marketplace-add runner before the plugin-install runner, letting the plugin step see the marketplace this run just added", async () => {
    await h.writeInstalledPlugins([]);
    const onRun = async (args: string[]) => {
      if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "add") {
        await h.writeKnownMarketplaces({ mp: githubSource("owner/repo") });
      }
    };

    await build({ ok: true, stdout: "" }, onRun).run(["backend"], Scope.Local, h.repoRoot, false, true, false);

    expect(runs).toEqual([
      ["plugin", "marketplace", "add", "owner/repo", "--scope", "local"],
      ["plugin", "install", "a@mp", "--scope", "local", "-y"],
    ]);
  });

  it("never invokes the marketplace-add runner when the marketplace is already known", async () => {
    await h.writeInstalledPlugins([]);
    await h.writeKnownMarketplaces({ mp: githubSource("owner/repo") });

    await build().run(["backend"], Scope.Local, h.repoRoot, false, true, false);

    expect(runs).toEqual([["plugin", "install", "a@mp", "--scope", "local", "-y"]]);
  });

  it("returns this run's own marketplace names and the still-uncached subset", async () => {
    await h.writeInstalledPlugins([]);

    const result = await build().run(["backend"], Scope.Local, h.repoRoot, false, false, false);

    expect(result.marketplaceNames).toEqual(new Set(["mp"]));
    expect(result.uncachedMarketplaceNames).toEqual(["mp"]);
  });

  it("omits a marketplace from uncachedMarketplaceNames once it's known to Claude Code", async () => {
    await h.writeInstalledPlugins([]);
    await h.writeKnownMarketplaces({ mp: githubSource("owner/repo") });

    const result = await build().run(["backend"], Scope.Local, h.repoRoot, false, false, false);

    expect(result.marketplaceNames).toEqual(new Set(["mp"]));
    expect(result.uncachedMarketplaceNames).toEqual([]);
  });

  it("never gates uncachedMarketplaceNames on a source that can't be converted to a CLI spec", async () => {
    // A hand-authored --source '<json>' (or create --from-scope copying an unfamiliar shape) can put
    // an arbitrary source on a module — MarketplaceSource is opaque and never validated. This must
    // be listed as still-missing (it genuinely isn't known to Claude Code) but never as "uncached",
    // since --install has nothing actionable to retry for it.
    await h.writeModule("odd-source", {
      enabledPlugins: {},
      extraKnownMarketplaces: { odd: { nope: true } },
    });
    await h.writeInstalledPlugins([]);

    const result = await build().run(["odd-source"], Scope.Local, h.repoRoot, false, true, false);

    expect(result.marketplaceNames).toEqual(new Set(["odd"]));
    expect(result.uncachedMarketplaceNames).toEqual([]);
    expect(runs).toEqual([]);
  });

  describe("merge vs. exclusive apply", () => {
    beforeEach(async () => {
      await h.writeModule("frontend", { enabledPlugins: { "f@mp": true }, extraKnownMarketplaces: {} });
    });

    it("merges by default: enabling a second module leaves the first module's plugin on", async () => {
      await h.writeInstalledPlugins([]);
      await build().run(["backend"], Scope.Local, h.repoRoot, false, false, false);

      await build().run(["frontend"], Scope.Local, h.repoRoot, false, false, false);

      const settings = JSON.parse(await h.readFileAt(join(".claude", "settings.local.json")));
      expect(settings.enabledPlugins).toEqual({ "a@mp": true, "f@mp": true });
    });

    it("--only replaces: enabling a second module with only=true turns the first module's plugin off", async () => {
      await h.writeInstalledPlugins([]);
      await build().run(["backend"], Scope.Local, h.repoRoot, false, false, false);

      await build().run(["frontend"], Scope.Local, h.repoRoot, true, false, false);

      const settings = JSON.parse(await h.readFileAt(join(".claude", "settings.local.json")));
      expect(settings.enabledPlugins).toEqual({ "a@mp": false, "f@mp": true });
    });
  });

  describe("--only outside a git repository", () => {
    it("does not throw when the default (local) scope has no repository to resolve project scope against", async () => {
      await h.writeInstalledPlugins([]);

      const result = await build().run(["backend"], Scope.Local, h.nonRepoDir, true, false, false);

      expect(result.resolvedScope.scope).toBe(Scope.Local);
      expect(result.enabledPluginNames).toEqual(new Set(["a@mp"]));
    });
  });
});

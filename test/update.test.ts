import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompositionResolver } from "../src/core/CompositionResolver.js";
import { ModuleListFile } from "../src/core/ModuleListFile.js";
import { ModuleResolver } from "../src/core/ModuleResolver.js";
import { ModuleStore } from "../src/core/ModuleStore.js";
import { ModuleUpdater } from "../src/core/ModuleUpdater.js";
import { RepoLocator } from "../src/core/RepoLocator.js";
import { ClaudeRunResult } from "../src/core/ClaudeRunner.js";
import { ResolvedModules } from "../src/core/moduleUnion.js";
import { Scope } from "../src/core/types.js";
import { UpdateCommand } from "../src/cli/commands/UpdateCommand.js";
import { CliError } from "../src/util/errors.js";
import { Logger, LogLevel } from "../src/util/Logger.js";
import { Paths } from "../src/util/Paths.js";
import { Harness, githubSource } from "./helpers/harness.js";

/**
 * ModuleUpdater is unit-tested directly with a fake ClaudeRunner, the same seam
 * test/marketplaceCache.test.ts and test/pluginCache.test.ts use for their installer classes.
 */
describe("ModuleUpdater", () => {
  function build(runs: string[][], result: ClaudeRunResult = { ok: true, stdout: "" }) {
    return new ModuleUpdater(new Logger(LogLevel.ERROR), {}, async (args) => {
      runs.push(args);
      return result;
    });
  }

  function resolved(overrides: Partial<ResolvedModules> = {}): ResolvedModules {
    return {
      enabledPluginNames: new Set(["b@mp", "a@mp"]),
      extraKnownMarketplaces: { z: githubSource("owner/z"), a: githubSource("owner/a") },
      ...overrides,
    };
  }

  it("updates marketplaces (sorted) before plugins (sorted)", async () => {
    const runs: string[][] = [];

    await build(runs).update(resolved(), Scope.Local, false);

    expect(runs).toEqual([
      ["plugin", "marketplace", "update", "a"],
      ["plugin", "marketplace", "update", "z"],
      ["plugin", "update", "a@mp", "--scope", "local", "-y"],
      ["plugin", "update", "b@mp", "--scope", "local", "-y"],
    ]);
  });

  it("passes the given scope through to 'claude plugin update' only — marketplace update takes no scope", async () => {
    const runs: string[][] = [];

    await build(runs).update(resolved({ extraKnownMarketplaces: {} }), Scope.Project, false);

    expect(runs).toEqual([
      ["plugin", "update", "a@mp", "--scope", "project", "-y"],
      ["plugin", "update", "b@mp", "--scope", "project", "-y"],
    ]);
  });

  it("never shells out under dryRun, and reports nothing updated or failed", async () => {
    const runs: string[][] = [];

    const result = await build(runs).update(resolved(), Scope.Local, true);

    expect(runs).toEqual([]);
    expect(result).toEqual({
      updatedMarketplaceNames: [],
      failedMarketplaceNames: [],
      updatedPluginKeys: [],
      failedPluginKeys: [],
    });
  });

  it("treats a failure as a warning, not a thrown error, and keeps attempting the rest", async () => {
    const runs: string[][] = [];

    const result = await build(runs, { ok: false, detail: "no network" }).update(resolved(), Scope.Local, false);

    expect(runs).toHaveLength(4); // both marketplaces and both plugins were still attempted
    expect(result.failedMarketplaceNames).toEqual(["a", "z"]);
    expect(result.failedPluginKeys).toEqual(["a@mp", "b@mp"]);
    expect(result.updatedMarketplaceNames).toEqual([]);
    expect(result.updatedPluginKeys).toEqual([]);
  });

  it("reports per-item success/failure independently", async () => {
    const runs: string[][] = [];
    const updater = new ModuleUpdater(new Logger(LogLevel.ERROR), {}, async (args) => {
      runs.push(args);
      return args[0] === "plugin" && args[1] === "update"
        ? { ok: false, detail: "not installed" }
        : { ok: true, stdout: "" };
    });

    const result = await updater.update(resolved(), Scope.Local, false);

    expect(result.updatedMarketplaceNames).toEqual(["a", "z"]);
    expect(result.failedMarketplaceNames).toEqual([]);
    expect(result.updatedPluginKeys).toEqual([]);
    expect(result.failedPluginKeys).toEqual(["a@mp", "b@mp"]);
  });
});

/**
 * UpdateCommand is unit-tested directly against a real ModuleResolver (over harness-written
 * modules) and a real ModuleUpdater backed by a fake ClaudeRunner — the same pattern
 * test/applyModulesUseCase.test.ts uses to isolate the shell-out seam while exercising real
 * module/composition resolution.
 */
describe("UpdateCommand", () => {
  let h: Harness;
  let paths: Paths;
  let moduleResolver: ModuleResolver;
  let moduleListFile: ModuleListFile;

  beforeEach(async () => {
    h = await Harness.create();
    paths = new Paths(h.env);
    const moduleStore = new ModuleStore(paths);
    const compositionResolver = new CompositionResolver(moduleStore);
    moduleResolver = new ModuleResolver(compositionResolver, new Logger(LogLevel.ERROR));
    moduleListFile = new ModuleListFile(paths, new RepoLocator());
    await h.writeModule("backend", {
      enabledPlugins: { "a@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
    });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  function build(runs: string[][], result: ClaudeRunResult = { ok: true, stdout: "" }, dryRun = false) {
    return (moduleNames: string[], scope: Scope = Scope.Local) =>
      new UpdateCommand(
        moduleNames,
        scope,
        h.repoRoot,
        moduleResolver,
        moduleListFile,
        new ModuleUpdater(new Logger(LogLevel.ERROR), {}, async (args) => {
          runs.push(args);
          return result;
        }),
        new Logger(LogLevel.ERROR),
        dryRun
      );
  }

  it("updates the given module's marketplaces then plugins", async () => {
    const runs: string[][] = [];

    await build(runs)(["backend"]).execute();

    expect(runs).toEqual([
      ["plugin", "marketplace", "update", "mp"],
      ["plugin", "update", "a@mp", "--scope", "local", "-y"],
    ]);
  });

  it("with no module names, updates the scope's saved active module list instead", async () => {
    await h.writeFileAt(".claude-modules.local", "backend\n");
    const runs: string[][] = [];

    await build(runs)([]).execute();

    expect(runs).toEqual([
      ["plugin", "marketplace", "update", "mp"],
      ["plugin", "update", "a@mp", "--scope", "local", "-y"],
    ]);
  });

  it("errors when no module names are given and the scope has no saved list", async () => {
    const runs: string[][] = [];

    await expect(build(runs)([]).execute()).rejects.toThrow("No module list found for local scope");
    expect(runs).toEqual([]);
  });

  it("errors for an unknown module name, same as enable/reload", async () => {
    const runs: string[][] = [];

    await expect(build(runs)(["ghost"]).execute()).rejects.toThrow("Module 'ghost' does not exist");
  });

  it("throws a CliError with exit code 2 when any item fails to update", async () => {
    const runs: string[][] = [];

    const err = await build(runs, { ok: false, detail: "no network" })(["backend"])
      .execute()
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).exitCode).toBe(2);
  });

  it("under --dry-run, never shells out and never throws even though nothing was actually attempted", async () => {
    const runs: string[][] = [];

    await build(runs, { ok: true, stdout: "" }, true)(["backend"]).execute();

    expect(runs).toEqual([]);
  });
});

/**
 * Error paths that never reach a real 'claude' binary — argument parsing, "no list found", unknown
 * module — are exercised through the full Harness/Cli, same as test/reload.test.ts. Anything that
 * would actually shell out (a real module update) is deliberately left to the unit tests above,
 * since Cli always wires up the real defaultClaudeRunner.
 */
describe("update (Cli)", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("errors when no list file exists for the scope", async () => {
    const result = await h.run(["update"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No module list found for local scope");
  });

  it("errors for an unknown module name", async () => {
    const result = await h.run(["update", "ghost"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Module 'ghost' does not exist");
  });

  it("prints usage for --help without shelling out", async () => {
    const result = await h.run(["update", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("claude-modules update");
  });

  it("--dry-run reports the commands it would run, without running them", async () => {
    await h.writeModule("backend", {
      enabledPlugins: { "a@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
    });

    const result = await h.run(["update", "backend", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("claude plugin marketplace update mp");
    expect(result.stdout).toContain("claude plugin update a@mp --scope local -y");
  });
});

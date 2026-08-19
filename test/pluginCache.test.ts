import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InstalledPluginsCache } from "../src/core/InstalledPluginsCache.js";
import { KnownMarketplacesCache } from "../src/core/KnownMarketplacesCache.js";
import { ClaudeRunResult, PluginCacheInstaller } from "../src/core/PluginCacheInstaller.js";
import { Paths } from "../src/util/Paths.js";
import { Logger, LogLevel } from "../src/util/Logger.js";

let claudeHome: string;
let paths: Paths;

beforeEach(async () => {
  claudeHome = await mkdtemp(join(tmpdir(), "claude-home-"));
  await mkdir(join(claudeHome, "plugins"), { recursive: true });
  paths = new Paths({ CLAUDE_CONFIG_DIR: claudeHome });
});

afterEach(async () => {
  await rm(claudeHome, { recursive: true, force: true });
});

async function writeInstalledPlugins(contents: unknown): Promise<void> {
  await writeFile(join(claudeHome, "plugins", "installed_plugins.json"), JSON.stringify(contents), "utf8");
}

describe("InstalledPluginsCache", () => {
  it("returns an empty set when Claude Code has never installed anything", async () => {
    expect(await new InstalledPluginsCache(paths).keys()).toEqual(new Set());
  });

  /**
   * Regression guard for a deliberate design decision that looks like a bug.
   *
   * `installed_plugins.json` entries carry `scope` and `projectPath`, and this cache ignores both —
   * an entry installed at `local` scope for some *other* project still counts as cached here. That
   * is correct: `claude plugin install` materializes plugin content into a single shared cache
   * directory (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>`) regardless of the scope
   * it was installed at, so the content really is on disk and available to every project. Verified
   * against a real installation where a plugin installed only at `local` scope for one repository
   * was fully populated in the shared cache.
   *
   * Filtering by scope here would produce spurious "not cached" warnings and redundant
   * `claude plugin install` calls. Don't "fix" it.
   */
  it("counts a plugin installed at local scope for another project as cached", async () => {
    await writeInstalledPlugins({
      version: 2,
      plugins: {
        "mongodb@mp": [{ scope: "local", projectPath: "/somewhere/else", installPath: "/shared/cache/mongodb" }],
      },
    });

    expect(await new InstalledPluginsCache(paths).keys()).toEqual(new Set(["mongodb@mp"]));
  });

  it("tolerates a file with no plugins key", async () => {
    await writeInstalledPlugins({ version: 2 });

    expect(await new InstalledPluginsCache(paths).keys()).toEqual(new Set());
  });
});

describe("KnownMarketplacesCache", () => {
  it("re-wraps an entry as { source } and drops machine-specific fields", async () => {
    await writeFile(
      join(claudeHome, "plugins", "known_marketplaces.json"),
      JSON.stringify({
        mp: {
          source: { source: "github", repo: "owner/repo" },
          installLocation: "/home/someone/.claude/plugins/marketplaces/mp",
          lastUpdated: "2026-01-01T00:00:00.000Z",
        },
      }),
      "utf8"
    );

    const entry = await new KnownMarketplacesCache(paths).get("mp");

    // installLocation/lastUpdated are this machine's state and must never reach a portable module.
    expect(entry).toEqual({ source: { source: "github", repo: "owner/repo" } });
  });

  it("returns undefined for an unknown marketplace", async () => {
    expect(await new KnownMarketplacesCache(paths).get("nope")).toBeUndefined();
  });
});

describe("PluginCacheInstaller", () => {
  function build(runs: string[][], result: ClaudeRunResult = { ok: true, stdout: "" }) {
    const installer = new PluginCacheInstaller(
      new KnownMarketplacesCache(paths),
      new InstalledPluginsCache(paths),
      new Logger(LogLevel.ERROR),
      {},
      async (args) => {
        runs.push(args);
        return result;
      }
    );
    return installer;
  }

  it("never shells out under --dry-run", async () => {
    await writeInstalledPlugins({ version: 2, plugins: {} });
    const runs: string[][] = [];

    await build(runs).ensureCached(["a@mp"], true);

    expect(runs).toEqual([]);
  });

  it("skips plugins Claude Code has already cached", async () => {
    await writeInstalledPlugins({ version: 2, plugins: { "a@mp": [{ scope: "user" }] } });
    const runs: string[][] = [];

    await build(runs).ensureCached(["a@mp"], false);

    expect(runs).toEqual([]);
  });

  it("installs an uncached plugin whose marketplace Claude Code knows", async () => {
    await writeInstalledPlugins({ version: 2, plugins: {} });
    await writeFile(
      join(claudeHome, "plugins", "known_marketplaces.json"),
      JSON.stringify({ mp: { source: { source: "github", repo: "owner/repo" } } }),
      "utf8"
    );
    const runs: string[][] = [];

    await build(runs).ensureCached(["a@mp"], false);

    expect(runs).toEqual([["plugin", "install", "a@mp", "--scope", "user", "-y"]]);
  });

  it("does not shell out when the marketplace is unknown to Claude Code", async () => {
    await writeInstalledPlugins({ version: 2, plugins: {} });
    const runs: string[][] = [];

    await build(runs).ensureCached(["a@mp"], false);

    expect(runs).toEqual([]);
  });

  it("treats an install failure as a warning, not a thrown error", async () => {
    await writeInstalledPlugins({ version: 2, plugins: {} });
    await writeFile(
      join(claudeHome, "plugins", "known_marketplaces.json"),
      JSON.stringify({ mp: { source: { source: "github", repo: "owner/repo" } } }),
      "utf8"
    );

    // The settings write is the primary operation; a caching failure must never undo it.
    await expect(
      build([], { ok: false, detail: "no network" }).ensureCached(["a@mp"], false)
    ).resolves.toBeUndefined();
  });
});

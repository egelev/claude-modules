import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KnownMarketplacesCache } from "../src/core/KnownMarketplacesCache.js";
import { MarketplaceCacheInstaller } from "../src/core/MarketplaceCacheInstaller.js";
import { marketplaceAddPlan } from "../src/core/marketplaceSpec.js";
import { ClaudeRunResult } from "../src/core/ClaudeRunner.js";
import { Paths } from "../src/util/Paths.js";
import { Logger, LogLevel } from "../src/util/Logger.js";
import { RecordingLogger } from "./helpers/harness.js";

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

async function writeKnownMarketplaces(entries: unknown): Promise<void> {
  await writeFile(join(claudeHome, "plugins", "known_marketplaces.json"), JSON.stringify(entries), "utf8");
}

describe("marketplaceAddPlan", () => {
  const cli = (...args: string[]) => ({ kind: "cli", args });

  it("recovers a github spec", () => {
    expect(marketplaceAddPlan({ source: { source: "github", repo: "owner/repo" } })).toEqual(cli("owner/repo"));
  });

  it("recovers a github spec with an @ref pin, verbatim", () => {
    expect(marketplaceAddPlan({ source: { source: "github", repo: "owner/repo@v2.0" } })).toEqual(
      cli("owner/repo@v2.0")
    );
  });

  it("appends a separate github ref field as @ref, unless repo is already pinned", () => {
    // Claude Code itself stores an 'owner/repo@ref' add as { repo, ref } — dropping ref would register
    // the default branch instead.
    expect(marketplaceAddPlan({ source: { source: "github", repo: "owner/repo", ref: "v2" } })).toEqual(
      cli("owner/repo@v2")
    );
    expect(marketplaceAddPlan({ source: { source: "github", repo: "owner/repo@v1", ref: "v2" } })).toEqual(
      cli("owner/repo@v1")
    );
  });

  it("carries sparsePaths over as --sparse", () => {
    expect(
      marketplaceAddPlan({ source: { source: "github", repo: "owner/repo", sparsePaths: [".claude-plugin", "plugins"] } })
    ).toEqual(cli("owner/repo", "--sparse", ".claude-plugin", "plugins"));
  });

  it("recovers a git spec, appending a separate ref as #ref", () => {
    expect(marketplaceAddPlan({ source: { source: "git", url: "https://example.com/mp.git" } })).toEqual(
      cli("https://example.com/mp.git")
    );
    expect(marketplaceAddPlan({ source: { source: "git", url: "https://example.com/mp.git", ref: "main" } })).toEqual(
      cli("https://example.com/mp.git#main")
    );
  });

  it("defers a github or git source with a custom path to settings.json — the CLI can't express it", () => {
    expect(
      marketplaceAddPlan({
        source: { source: "github", repo: "owner/repo", path: "sub/dir/.claude-plugin/marketplace.json" },
      })
    ).toEqual({ kind: "from-settings", description: "a 'github' source with a custom 'path'" });
    expect(
      marketplaceAddPlan({ source: { source: "git", url: "https://example.com/mp.git", path: "x/marketplace.json" } })
    ).toMatchObject({ kind: "from-settings" });
  });

  it("treats a path equal to the default manifest location as no path at all", () => {
    expect(
      marketplaceAddPlan({ source: { source: "github", repo: "owner/repo", path: ".claude-plugin/marketplace.json" } })
    ).toEqual(cli("owner/repo"));
  });

  it("defers an inline settings source to settings.json", () => {
    expect(
      marketplaceAddPlan({ source: { source: "settings", name: "mp", plugins: [] } })
    ).toEqual({ kind: "from-settings", description: "an inline 'settings' source" });
  });

  it("recovers a url source, unless it needs request headers", () => {
    expect(marketplaceAddPlan({ source: { source: "url", url: "https://example.com/marketplace.json" } })).toEqual(
      cli("https://example.com/marketplace.json")
    );
    expect(
      marketplaceAddPlan({
        source: { source: "url", url: "https://example.com/marketplace.json", headers: { Authorization: "x" } },
      })
    ).toMatchObject({ kind: "from-settings" });
  });

  it("recovers local, directory, and file specs from their path", () => {
    expect(marketplaceAddPlan({ source: { source: "local", path: "/some/path" } })).toEqual(cli("/some/path"));
    expect(marketplaceAddPlan({ source: { source: "directory", path: "/some/dir" } })).toEqual(cli("/some/dir"));
    expect(marketplaceAddPlan({ source: { source: "file", path: "/some/marketplace.json" } })).toEqual(
      cli("/some/marketplace.json")
    );
  });

  it("returns unknown for an unrecognized or incomplete source shape", () => {
    expect(marketplaceAddPlan({ source: { source: "unknown-kind" } })).toEqual({ kind: "unknown" });
    expect(marketplaceAddPlan({ source: { source: "github" } })).toEqual({ kind: "unknown" });
    expect(marketplaceAddPlan({})).toEqual({ kind: "unknown" });
    expect(marketplaceAddPlan(undefined)).toEqual({ kind: "unknown" });
  });
});

describe("MarketplaceCacheInstaller", () => {
  function build(runs: string[][], result: ClaudeRunResult = { ok: true, stdout: "" }) {
    return new MarketplaceCacheInstaller(new KnownMarketplacesCache(paths), new Logger(LogLevel.ERROR), {}, async (args) => {
      runs.push(args);
      return result;
    });
  }

  it("never shells out under --dry-run", async () => {
    const runs: string[][] = [];

    await build(runs).ensureCached({ mp: { source: { source: "github", repo: "owner/repo" } } }, true);

    expect(runs).toEqual([]);
  });

  it("skips a marketplace already known to Claude Code", async () => {
    await writeKnownMarketplaces({ mp: { source: { source: "github", repo: "owner/repo" } } });
    const runs: string[][] = [];

    await build(runs).ensureCached({ mp: { source: { source: "github", repo: "owner/repo" } } }, false);

    expect(runs).toEqual([]);
  });

  it("adds an unknown marketplace with the expected args", async () => {
    const runs: string[][] = [];

    await build(runs).ensureCached({ mp: { source: { source: "github", repo: "owner/repo" } } }, false);

    expect(runs).toEqual([["plugin", "marketplace", "add", "owner/repo", "--scope", "user"]]);
  });

  it("passes --sparse through to the add command", async () => {
    const runs: string[][] = [];

    await build(runs).ensureCached(
      { mp: { source: { source: "github", repo: "owner/repo", sparsePaths: ["plugins"] } } },
      false
    );

    expect(runs).toEqual([["plugin", "marketplace", "add", "owner/repo", "--sparse", "plugins", "--scope", "user"]]);
  });

  it("logs info, never a warning, and doesn't shell out for a source only settings.json can express", async () => {
    const runs: string[][] = [];
    const logger = new RecordingLogger();
    const installer = new MarketplaceCacheInstaller(new KnownMarketplacesCache(paths), logger, {}, async (args) => {
      runs.push(args);
      return { ok: true, stdout: "" };
    });

    await installer.ensureCached({ mp: { source: { source: "settings", name: "mp", plugins: [] } } }, false);

    expect(runs).toEqual([]);
    expect(logger.warnings).toEqual([]);
    expect(logger.infos.join("\n")).toContain("next session start");
  });

  it("warns without shelling out when the source isn't spec-convertible", async () => {
    const runs: string[][] = [];

    await build(runs).ensureCached({ mp: { source: { source: "unknown-kind" } } }, false);

    expect(runs).toEqual([]);
  });

  it("treats an add failure as a warning, not a thrown error", async () => {
    // The settings write is the primary operation; a caching failure must never undo it.
    await expect(
      build([], { ok: false, detail: "no network" }).ensureCached(
        { mp: { source: { source: "github", repo: "owner/repo" } } },
        false
      )
    ).resolves.toBeUndefined();
  });

  describe("missing", () => {
    it("is empty when every marketplace is already known", async () => {
      await writeKnownMarketplaces({ mp: { source: { source: "github", repo: "owner/repo" } } });

      const missing = await build([]).missing({ mp: { source: { source: "github", repo: "owner/repo" } } });

      expect(missing).toEqual([]);
    });

    it("returns the names of marketplaces Claude Code doesn't know about", async () => {
      const missing = await build([]).missing({
        b: { source: { source: "github", repo: "owner/b" } },
        a: { source: { source: "github", repo: "owner/a" } },
      });

      expect(missing).toEqual(["a", "b"]);
    });
  });
});

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KnownMarketplacesCache } from "../src/core/KnownMarketplacesCache.js";
import { MarketplaceCacheInstaller } from "../src/core/MarketplaceCacheInstaller.js";
import { marketplaceSpecFromSource } from "../src/core/marketplaceSpec.js";
import { ClaudeRunResult } from "../src/core/ClaudeRunner.js";
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

async function writeKnownMarketplaces(entries: unknown): Promise<void> {
  await writeFile(join(claudeHome, "plugins", "known_marketplaces.json"), JSON.stringify(entries), "utf8");
}

describe("marketplaceSpecFromSource", () => {
  it("recovers a github spec", () => {
    expect(marketplaceSpecFromSource({ source: { source: "github", repo: "owner/repo" } })).toBe("owner/repo");
  });

  it("recovers a github spec with an @ref pin, verbatim", () => {
    expect(marketplaceSpecFromSource({ source: { source: "github", repo: "owner/repo@v2.0" } })).toBe(
      "owner/repo@v2.0"
    );
  });

  it("recovers a git spec", () => {
    expect(marketplaceSpecFromSource({ source: { source: "git", url: "https://example.com/mp.git" } })).toBe(
      "https://example.com/mp.git"
    );
  });

  it("recovers a local spec", () => {
    expect(marketplaceSpecFromSource({ source: { source: "local", path: "/some/path" } })).toBe("/some/path");
  });

  it("returns undefined for an unrecognized source shape", () => {
    expect(marketplaceSpecFromSource({ source: { source: "unknown-kind" } })).toBeUndefined();
    expect(marketplaceSpecFromSource({})).toBeUndefined();
    expect(marketplaceSpecFromSource(undefined)).toBeUndefined();
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

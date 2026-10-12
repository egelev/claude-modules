import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModuleStore } from "../src/core/ModuleStore.js";
import { ModuleNotFoundError } from "../src/util/errors.js";
import { Paths } from "../src/util/Paths.js";
import { Harness } from "./helpers/harness.js";

describe("ModuleStore.remove", () => {
  let h: Harness;
  let store: ModuleStore;

  beforeEach(async () => {
    h = await Harness.create();
    store = new ModuleStore(new Paths(h.env));
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("deletes a directory with a loadable settings.json", async () => {
    await store.create("demo");

    await store.remove("demo");

    expect(await store.exists("demo")).toBe(false);
  });

  it("throws ModuleNotFoundError when the directory doesn't exist at all", async () => {
    await expect(store.remove("ghost")).rejects.toThrow(ModuleNotFoundError);
  });

  it("also deletes a bare directory with no settings.json, unlike exists()/load()", async () => {
    // The asymmetry this pins: exists()/load() require a *loadable* settings.json, so they report
    // a leftover directory (e.g. from an import that crashed partway through copyRenamed) as "not
    // found". remove() only checks that the directory itself exists via a raw fs.rm, so calling it
    // directly — as done here — deletes such a directory outright. RemoveModuleCommand never
    // reaches this path in practice: it guards on exists() first and warns instead of deleting (see
    // remove.test.ts's "warns (does not delete) a stray directory" case), so this behavior is only
    // reachable by calling ModuleStore directly, as this test does.
    const dir = join(h.modulesHome, "modules", "junk");
    await mkdir(dir, { recursive: true });
    expect(await store.exists("junk")).toBe(false);

    await store.remove("junk");

    const entries = await readdir(join(h.modulesHome, "modules"));
    expect(entries).not.toContain("junk");
  });
});

describe("ModuleStore.load", () => {
  let h: Harness;
  let store: ModuleStore;

  beforeEach(async () => {
    h = await Harness.create();
    store = new ModuleStore(new Paths(h.env));
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("upgrades marketplace sources an older version stored, without rewriting the file", async () => {
    await h.writeModule("demo", {
      enabledPlugins: {},
      extraKnownMarketplaces: {
        local: { source: { source: "local", path: "/home/someone/mp" } },
        pinned: { source: { source: "github", repo: "owner/repo@v2" } },
        current: { source: { source: "github", repo: "owner/other" } },
      },
    });

    const module = await store.load("demo");

    expect(module.extraKnownMarketplaces).toEqual({
      local: { source: { source: "directory", path: "/home/someone/mp" } },
      pinned: { source: { source: "github", repo: "owner/repo", ref: "v2" } },
      current: { source: { source: "github", repo: "owner/other" } },
    });
    const onDisk = JSON.parse(await h.readFileAt(join("modules", "demo", "settings.json"), h.modulesHome));
    expect(onDisk.extraKnownMarketplaces.local).toEqual({ source: { source: "local", path: "/home/someone/mp" } });
  });
});

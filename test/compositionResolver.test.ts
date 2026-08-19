import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompositionResolver } from "../src/core/CompositionResolver.js";
import { ModuleStore } from "../src/core/ModuleStore.js";
import { emptyModule, Module } from "../src/core/types.js";
import { CompositionCycleError, MarketplaceConflictError, ModuleNotFoundError } from "../src/util/errors.js";
import { Paths } from "../src/util/Paths.js";
import { githubSource } from "./helpers/harness.js";

let modulesHome: string;
let moduleStore: ModuleStore;
let resolver: CompositionResolver;

beforeEach(async () => {
  modulesHome = await mkdtemp(join(tmpdir(), "claude-modules-composition-"));
  moduleStore = new ModuleStore(new Paths({ CLAUDE_MODULES_HOME: modulesHome }));
  resolver = new CompositionResolver(moduleStore);
});

afterEach(async () => {
  await rm(modulesHome, { recursive: true, force: true });
});

function module(overrides: Partial<Module> = {}): Module {
  return { ...emptyModule(), ...overrides };
}

describe("CompositionResolver.resolveEffective", () => {
  it("returns a module's own contents when it composes nothing", async () => {
    await moduleStore.save("solo", module({ enabledPlugins: { "a@mp": true } }));

    const effective = await resolver.resolveEffective("solo");

    expect(effective).toEqual({ enabledPlugins: { "a@mp": true }, extraKnownMarketplaces: {} });
  });

  it("throws CompositionCycleError on direct self-composition", async () => {
    await moduleStore.save("a", module({ composedModules: ["a"] }));

    await expect(resolver.resolveEffective("a")).rejects.toThrow(CompositionCycleError);
  });

  it("throws CompositionCycleError on a deeper cycle (A -> B -> A)", async () => {
    await moduleStore.save("a", module({ composedModules: ["b"] }));
    await moduleStore.save("b", module({ composedModules: ["a"] }));

    await expect(resolver.resolveEffective("a")).rejects.toThrow(CompositionCycleError);
  });

  it("throws CompositionCycleError when a dangling reference completes a cycle after recreation", async () => {
    // Q composes P; P is later removed; a new P composes Q — the cycle only closes now.
    await moduleStore.save("q", module({ composedModules: ["p"] }));
    await moduleStore.save("p", module({ composedModules: ["q"] }));

    await expect(resolver.resolveEffective("p")).rejects.toThrow(CompositionCycleError);
  });

  it("throws ModuleNotFoundError for a missing composed module", async () => {
    await moduleStore.save("a", module({ composedModules: ["missing"] }));

    await expect(resolver.resolveEffective("a")).rejects.toThrow(ModuleNotFoundError);
  });

  it("resolves a diamond without error, applying the shared ancestor's contribution once", async () => {
    await moduleStore.save("d", module({ enabledPlugins: { "d@mp": true } }));
    await moduleStore.save("b", module({ composedModules: ["d"] }));
    await moduleStore.save("c", module({ composedModules: ["d"] }));
    await moduleStore.save("a", module({ composedModules: ["b", "c"] }));

    const effective = await resolver.resolveEffective("a");

    expect(effective.enabledPlugins).toEqual({ "d@mp": true });
  });

  it("a composed module's plugin is inherited when self doesn't mention it", async () => {
    await moduleStore.save("base", module({ enabledPlugins: { "x@mp": true } }));
    await moduleStore.save("child", module({ composedModules: ["base"] }));

    const effective = await resolver.resolveEffective("child");

    expect(effective.enabledPlugins).toEqual({ "x@mp": true });
  });

  it("self's own enabledPlugins entry wins over a composed module's", async () => {
    await moduleStore.save("base", module({ enabledPlugins: { "x@mp": true } }));
    await moduleStore.save("child", module({ enabledPlugins: { "x@mp": false }, composedModules: ["base"] }));

    const effective = await resolver.resolveEffective("child");

    expect(effective.enabledPlugins["x@mp"]).toBe(false);
  });

  it("self's own marketplace source wins over a composed module's, without conflict", async () => {
    const composedSource = githubSource("owner/composed-repo");
    const selfSource = githubSource("owner/self-repo");
    await moduleStore.save("base", module({ extraKnownMarketplaces: { mp: composedSource } }));
    await moduleStore.save(
      "child",
      module({ extraKnownMarketplaces: { mp: selfSource }, composedModules: ["base"] })
    );

    const effective = await resolver.resolveEffective("child");

    expect(effective.extraKnownMarketplaces.mp).toEqual(selfSource);
  });

  it("throws MarketplaceConflictError for conflicting sources between composed siblings, self silent", async () => {
    await moduleStore.save("b", module({ extraKnownMarketplaces: { mp: githubSource("owner/b-repo") } }));
    await moduleStore.save("c", module({ extraKnownMarketplaces: { mp: githubSource("owner/c-repo") } }));
    await moduleStore.save("a", module({ composedModules: ["b", "c"] }));

    await expect(resolver.resolveEffective("a")).rejects.toThrow(MarketplaceConflictError);
  });

  it("validates a prospective composition via the overrides map before anything is saved", async () => {
    await moduleStore.save("base", module({ enabledPlugins: { "x@mp": true } }));
    const prospective = module({ composedModules: ["base"] });

    const effective = await resolver.resolveEffective("new-module", new Map([["new-module", prospective]]));

    expect(effective.enabledPlugins).toEqual({ "x@mp": true });
    await expect(moduleStore.exists("new-module")).resolves.toBe(false);
  });

  it("detects self-composition via the overrides map (create --compose self)", async () => {
    const prospective = module({ composedModules: ["new-module"] });

    await expect(
      resolver.resolveEffective("new-module", new Map([["new-module", prospective]]))
    ).rejects.toThrow(CompositionCycleError);
  });
});

describe("CompositionResolver.resolveEffectivePluginNames", () => {
  it("never throws on a sibling marketplace conflict that resolveEffective would", async () => {
    await moduleStore.save("b", module({ extraKnownMarketplaces: { mp: githubSource("owner/b-repo") } }));
    await moduleStore.save("c", module({ extraKnownMarketplaces: { mp: githubSource("owner/c-repo") } }));
    await moduleStore.save("a", module({ composedModules: ["b", "c"] }));

    await expect(resolver.resolveEffectivePluginNames("a")).resolves.toEqual(new Set());
  });

  it("flattens composed plugin names with self's overrides applied", async () => {
    await moduleStore.save("base", module({ enabledPlugins: { "x@mp": true, "y@mp": true } }));
    await moduleStore.save(
      "child",
      module({ enabledPlugins: { "y@mp": false, "z@mp": true }, composedModules: ["base"] })
    );

    const names = await resolver.resolveEffectivePluginNames("child");

    expect(names).toEqual(new Set(["x@mp", "z@mp"]));
  });

  it("still throws CompositionCycleError on a cycle", async () => {
    await moduleStore.save("a", module({ composedModules: ["a"] }));

    await expect(resolver.resolveEffectivePluginNames("a")).rejects.toThrow(CompositionCycleError);
  });
});

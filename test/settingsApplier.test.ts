import { describe, expect, it, vi } from "vitest";
import { SettingsApplier } from "../src/core/SettingsApplier.js";
import { ResolvedModules } from "../src/core/ModuleResolver.js";
import { Logger, LogLevel } from "../src/util/Logger.js";
import { githubSource } from "./helpers/harness.js";

const applier = new SettingsApplier(new Logger(LogLevel.ERROR));

function union(pluginNames: string[], marketplaces: Record<string, unknown> = {}): ResolvedModules {
  return { enabledPluginNames: new Set(pluginNames), extraKnownMarketplaces: marketplaces };
}

describe("SettingsApplier.apply", () => {
  it("preserves settings keys it doesn't understand", () => {
    const existing = {
      permissions: { allow: ["Read"] },
      theme: "light",
      enabledPlugins: { "a@mp": true },
    };

    const result = applier.apply(existing, union(["b@mp"]));

    expect(result.permissions).toEqual({ allow: ["Read"] });
    expect(result.theme).toBe("light");
  });

  it("merges by default: a plugin outside the union is left exactly as it was", () => {
    const existing = { enabledPlugins: { "a@mp": true, "b@mp": false, "c@mp": true } };

    const result = applier.apply(existing, union(["c@mp"]));

    // This is what makes a separate `enable` for another module additive rather than a
    // replacement — the property `enable --only` opts back out of via `exclusive: true` below.
    expect(result.enabledPlugins).toEqual({ "a@mp": true, "b@mp": false, "c@mp": true });
  });

  it("exclusive mode: a previously-enabled plugin outside the union is turned off", () => {
    const existing = { enabledPlugins: { "a@mp": true, "b@mp": true } };

    const result = applier.apply(existing, union(["b@mp"]), { exclusive: true });

    expect(result.enabledPlugins).toEqual({ "a@mp": false, "b@mp": true });
  });

  it("exclusive mode keeps disabled plugin keys rather than deleting them", () => {
    const result = applier.apply({ enabledPlugins: { "a@mp": true } }, union([]), { exclusive: true });

    expect(Object.keys(result.enabledPlugins!)).toContain("a@mp");
    expect(result.enabledPlugins!["a@mp"]).toBe(false);
  });

  it("adds missing marketplaces but never overwrites an existing entry", () => {
    const existing = { extraKnownMarketplaces: { mp: githubSource("original/repo") } };

    const result = applier.apply(existing, union([], { mp: githubSource("other/repo"), new: githubSource("a/b") }));

    expect(result.extraKnownMarketplaces!["mp"]).toEqual(githubSource("original/repo"));
    expect(result.extraKnownMarketplaces!["new"]).toEqual(githubSource("a/b"));
  });

  it("warns when a differing marketplace source is discarded, rather than staying silent", () => {
    const logger = new Logger(LogLevel.WARN);
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const loggingApplier = new SettingsApplier(logger);
    const existing = { extraKnownMarketplaces: { mp: githubSource("original/repo") } };

    loggingApplier.apply(existing, union([], { mp: githubSource("other/repo") }));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain("mp");
  });

  it("does not warn when a matching marketplace source is re-declared", () => {
    const logger = new Logger(LogLevel.WARN);
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const loggingApplier = new SettingsApplier(logger);
    const existing = { extraKnownMarketplaces: { mp: githubSource("owner/repo") } };

    loggingApplier.apply(existing, union([], { mp: githubSource("owner/repo") }));

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("handles a settings file with no plugin keys at all", () => {
    const result = applier.apply({}, union(["a@mp"]));

    expect(result.enabledPlugins).toEqual({ "a@mp": true });
  });
});

describe("SettingsApplier.disable", () => {
  it("only touches keys already present — no phantom false entry", () => {
    const result = applier.disable({ enabledPlugins: { "a@mp": true } }, new Set(["a@mp", "never-here@mp"]));

    expect(result.enabledPlugins).toEqual({ "a@mp": false });
    expect(result.enabledPlugins).not.toHaveProperty("never-here@mp");
  });

  it("leaves marketplaces untouched", () => {
    const existing = {
      enabledPlugins: { "a@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
    };

    const result = applier.disable(existing, new Set(["a@mp"]));

    expect(result.extraKnownMarketplaces).toEqual({ mp: githubSource("owner/repo") });
  });
});

describe("SettingsApplier.disableForeign", () => {
  it("creates the key when absent — the inverse of disable()", () => {
    const result = applier.disableForeign({ enabledPlugins: {} }, new Set(["inherited@mp"]));

    expect(result.enabledPlugins).toEqual({ "inherited@mp": false });
  });
});

describe("SettingsApplier.disableAll", () => {
  it("flips every known key to false and preserves other settings", () => {
    const result = applier.disableAll({
      enabledPlugins: { "a@mp": true, "b@mp": false },
      theme: "dark",
    });

    expect(result.enabledPlugins).toEqual({ "a@mp": false, "b@mp": false });
    expect(result.theme).toBe("dark");
  });
});

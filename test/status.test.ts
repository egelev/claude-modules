import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness } from "./helpers/harness.js";

/**
 * `status`'s exit codes are a documented CI contract (README: 0 clean / 1 couldn't run / 2 found a
 * problem), so they're pinned here rather than left to the prose.
 */
describe("status exit codes", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("backend", { enabledPlugins: { "jdtls@mp": true }, extraKnownMarketplaces: {} });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("exits 0 when everything is cached and matches the listed modules", async () => {
    await h.writeInstalledPlugins(["jdtls@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true } });
    await h.writeFileAt(".claude-modules.local", "backend\n");

    const result = await h.run(["status"]);

    expect(result.code).toBe(0);
  });

  it("exits 1 when it can't run at all", async () => {
    const result = await h.run(["status", "--scope", "galaxy"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid --scope");
  });

  it("exits 1 with a clear error for a corrupted settings.json, not a raw stack trace", async () => {
    await h.writeFileAt(".claude/settings.local.json", "{ not valid json");

    const result = await h.run(["status"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not valid JSON");
    expect(result.stderr).not.toContain("SyntaxError:");
    expect(result.stderr).not.toMatch(/at .*SettingsRepository\.ts:\d+/);
  });

  it("exits 2 when an enabled plugin isn't cached by Claude Code", async () => {
    await h.writeInstalledPlugins([]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true } });

    const result = await h.run(["status"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("not cached");
  });

  it("exits 2 when a listed module wants a plugin that isn't enabled", async () => {
    await h.writeInstalledPlugins(["jdtls@mp"]);
    await h.writeSettings("local", { enabledPlugins: {} });
    await h.writeFileAt(".claude-modules.local", "backend\n");

    const result = await h.run(["status"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("aren't enabled");
  });

  it("exits 2 when a plugin is enabled that no listed module declares", async () => {
    await h.writeInstalledPlugins(["jdtls@mp", "stray@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true, "stray@mp": true } });
    await h.writeFileAt(".claude-modules.local", "backend\n");

    const result = await h.run(["status"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("stray@mp");
  });

  it("does not report an explicit-false entry from --only as stale", async () => {
    await h.writeInstalledPlugins(["jdtls@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true, "overridden@mp": false } });
    await h.writeFileAt(".claude-modules.local", "backend\n");

    const result = await h.run(["status"]);

    expect(result.code).toBe(0);
  });

  it("is clean when the scope has no module list — nothing to compare against", async () => {
    await h.writeInstalledPlugins(["jdtls@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true } });

    const result = await h.run(["status"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("skipping module-drift check");
  });

  it("writes nothing", async () => {
    await h.writeInstalledPlugins(["jdtls@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true } });
    const before = await h.readSettings("local");

    await h.run(["status"]);

    expect(await h.readSettings("local")).toEqual(before);
  });

  it("reports an unresolvable listed module as a problem rather than crashing", async () => {
    await h.writeInstalledPlugins([]);
    await h.writeSettings("local", { enabledPlugins: {} });
    await h.writeFileAt(".claude-modules.local", "deleted-module\n");

    const result = await h.run(["status"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Could not resolve");
  });
});

describe("status scope precedence reporting", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeInstalledPlugins(["from-user@mp"]);
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("annotates a user-scope plugin that the local scope explicitly disables", async () => {
    await h.writeSettings("user", { enabledPlugins: { "from-user@mp": true } });
    await h.writeSettings("local", { enabledPlugins: { "from-user@mp": false } });

    const result = await h.run(["status"]);

    expect(result.stdout).toContain("(user — overridden by local)");
    // Overridden means inactive, so its cache state is irrelevant and must not fail the run.
    expect(result.code).toBe(0);
  });
});

describe("status --json", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("backend", { enabledPlugins: { "jdtls@mp": true }, extraKnownMarketplaces: {} });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  function parsedPayload(result: { stdout: string }): unknown {
    return JSON.parse(result.stdout);
  }

  it("prints a clean payload with no problems", async () => {
    await h.writeInstalledPlugins(["jdtls@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true } });
    await h.writeFileAt(".claude-modules.local", "backend\n");

    const result = await h.run(["status", "--json"]);

    expect(result.code).toBe(0);
    expect(parsedPayload(result)).toEqual({
      ok: true,
      scope: "local",
      settingsPath: h.settingsPath("local"),
      checks: {
        cache: { uncachedPluginKeys: [] },
        moduleList: {
          listFilePath: h.moduleListPath("local"),
          resolutionFailed: false,
          missingPluginKeys: [],
          stalePluginKeys: [],
        },
        verify: null,
      },
    });
  });

  it("reports an uncached plugin", async () => {
    await h.writeInstalledPlugins([]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true } });

    const result = await h.run(["status", "--json"]);

    expect(result.code).toBe(2);
    const payload = parsedPayload(result) as { ok: boolean; checks: { cache: { uncachedPluginKeys: string[] } } };
    expect(payload.ok).toBe(false);
    expect(payload.checks.cache.uncachedPluginKeys).toEqual(["jdtls@mp"]);
  });

  it("reports missing plugins from the listed module(s)", async () => {
    await h.writeInstalledPlugins(["jdtls@mp"]);
    await h.writeSettings("local", { enabledPlugins: {} });
    await h.writeFileAt(".claude-modules.local", "backend\n");

    const result = await h.run(["status", "--json"]);

    expect(result.code).toBe(2);
    const payload = parsedPayload(result) as {
      ok: boolean;
      checks: { moduleList: { missingPluginKeys: string[] } };
    };
    expect(payload.ok).toBe(false);
    expect(payload.checks.moduleList.missingPluginKeys).toEqual(["jdtls@mp"]);
  });

  it("reports stale plugins not declared by any listed module", async () => {
    await h.writeInstalledPlugins(["jdtls@mp", "stray@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true, "stray@mp": true } });
    await h.writeFileAt(".claude-modules.local", "backend\n");

    const result = await h.run(["status", "--json"]);

    expect(result.code).toBe(2);
    const payload = parsedPayload(result) as {
      ok: boolean;
      checks: { moduleList: { stalePluginKeys: string[] } };
    };
    expect(payload.ok).toBe(false);
    expect(payload.checks.moduleList.stalePluginKeys).toEqual(["stray@mp"]);
  });

  it("reports a resolutionFailed listed module", async () => {
    await h.writeInstalledPlugins([]);
    await h.writeSettings("local", { enabledPlugins: {} });
    await h.writeFileAt(".claude-modules.local", "deleted-module\n");

    const result = await h.run(["status", "--json"]);

    expect(result.code).toBe(2);
    const payload = parsedPayload(result) as { ok: boolean; checks: { moduleList: { resolutionFailed: boolean } } };
    expect(payload.ok).toBe(false);
    expect(payload.checks.moduleList.resolutionFailed).toBe(true);
  });

  it("leaves checks.verify null without --verify", async () => {
    await h.writeInstalledPlugins(["jdtls@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true } });

    const result = await h.run(["status", "--json"]);

    const payload = parsedPayload(result) as { checks: { verify: unknown } };
    expect(payload.checks.verify).toBeNull();
  });

  it("populates checks.verify with --verify", async () => {
    await h.writeInstalledPlugins(["jdtls@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true } });

    const result = await h.run(["status", "--json", "--verify"]);

    const payload = parsedPayload(result) as {
      checks: { verify: { ran: boolean; unavailable: boolean; unexpectedlyEnabled: string[]; unexpectedlyDisabled: string[] } | null };
    };
    expect(payload.checks.verify).not.toBeNull();
    expect(payload.checks.verify?.ran).toBe(true);
  });

  it("still reports unavailable: true in the payload when claude is unreachable, rather than dropping the signal", async () => {
    // The env here has no PATH (see test/verify.test.ts), so the verifier's warning would normally
    // print — but it's suppressed under quiet. Confirms that signal survives into the JSON instead
    // of being silently dropped.
    await h.writeInstalledPlugins(["jdtls@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true } });

    const result = await h.run(["status", "--json", "--verify"]);

    expect(result.code).toBe(0);
    const payload = parsedPayload(result) as { checks: { verify: { unavailable: boolean } | null } };
    expect(payload.checks.verify?.unavailable).toBe(true);
    // Without --json this warning prints (see test/verify.test.ts) — under --json it's suppressed,
    // and this assertion is what proves the signal relocated into the payload instead of vanishing.
    expect(result.stderr).not.toContain("Could not verify");
  });

  it("prints stdout that parses cleanly as JSON, with no stray prose", async () => {
    await h.writeInstalledPlugins(["jdtls@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true } });
    await h.writeFileAt(".claude-modules.local", "backend\n");

    const result = await h.run(["status", "--json", "--verify"]);

    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it("a plain non-json status call still prints its existing prose unchanged", async () => {
    await h.writeInstalledPlugins(["jdtls@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true } });

    const result = await h.run(["status"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Enabled plugin(s):");
    expect(result.stdout).toContain("All effectively-enabled plugins are cached by Claude Code");
    expect(() => JSON.parse(result.stdout)).toThrow();
  });
});

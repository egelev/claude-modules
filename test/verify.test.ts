import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnabledPluginsVerifier } from "../src/core/EnabledPluginsVerifier.js";
import { ClaudeRunResult } from "../src/core/PluginCacheInstaller.js";
import { Logger, LogLevel } from "../src/util/Logger.js";
import { Harness } from "./helpers/harness.js";

function verifier(result: ClaudeRunResult, runs: string[][] = []): EnabledPluginsVerifier {
  return new EnabledPluginsVerifier(new Logger(LogLevel.ERROR), {}, async (args) => {
    runs.push(args);
    return result;
  });
}

function listJson(entries: { id: string; scope: string; enabled: boolean }[]): ClaudeRunResult {
  return { ok: true, stdout: JSON.stringify(entries) };
}

describe("EnabledPluginsVerifier", () => {
  it("asks Claude Code for its own resolution", async () => {
    const runs: string[][] = [];

    await verifier(listJson([]), runs).verify(new Set());

    expect(runs).toEqual([["plugin", "list", "--json"]]);
  });

  it("reports no drift when both agree", async () => {
    const result = await verifier(listJson([{ id: "a@mp", scope: "user", enabled: true }])).verify(new Set(["a@mp"]));

    expect(result).toEqual({ unavailable: false, unexpectedlyEnabled: [], unexpectedlyDisabled: [] });
  });

  it("flags a plugin Claude Code disables that this tool considers enabled", async () => {
    // The managed-settings case: policy forces the plugin off, settings.json still says true.
    const result = await verifier(listJson([{ id: "a@mp", scope: "user", enabled: false }])).verify(new Set(["a@mp"]));

    expect(result.unexpectedlyDisabled).toEqual(["a@mp"]);
    expect(result.unexpectedlyEnabled).toEqual([]);
  });

  it("flags a plugin Claude Code enables that no module accounts for", async () => {
    const result = await verifier(listJson([{ id: "forced@mp", scope: "user", enabled: true }])).verify(new Set());

    expect(result.unexpectedlyEnabled).toEqual(["forced@mp"]);
  });

  it("treats a plugin as enabled if any of its per-scope rows says so", async () => {
    // `claude plugin list --json` emits one row per install scope, sharing the resolved value.
    const result = await verifier(
      listJson([
        { id: "a@mp", scope: "user", enabled: true },
        { id: "a@mp", scope: "local", enabled: true },
      ])
    ).verify(new Set(["a@mp"]));

    expect(result.unexpectedlyDisabled).toEqual([]);
    expect(result.unexpectedlyEnabled).toEqual([]);
  });

  it("ignores a plugin Claude Code has never installed — that's the not-cached check's job", async () => {
    const result = await verifier(listJson([])).verify(new Set(["never-installed@mp"]));

    expect(result.unexpectedlyDisabled).toEqual([]);
    expect(result.unavailable).toBe(false);
  });

  it("degrades to unavailable when claude can't be run", async () => {
    const result = await verifier({ ok: false, detail: "'claude' not found on PATH" }).verify(new Set(["a@mp"]));

    expect(result).toEqual({ unavailable: true, unexpectedlyEnabled: [], unexpectedlyDisabled: [] });
  });

  it("degrades to unavailable on unparseable output", async () => {
    const result = await verifier({ ok: true, stdout: "not json at all" }).verify(new Set(["a@mp"]));

    expect(result.unavailable).toBe(true);
  });

  it("degrades to unavailable when the output isn't an array", async () => {
    const result = await verifier({ ok: true, stdout: '{"plugins":[]}' }).verify(new Set());

    expect(result.unavailable).toBe(true);
  });

  it("skips malformed rows rather than crashing", async () => {
    const result = await verifier({ ok: true, stdout: '[{"enabled":true},{"id":"a@mp","enabled":true}]' }).verify(
      new Set(["a@mp"])
    );

    expect(result.unavailable).toBe(false);
    expect(result.unexpectedlyEnabled).toEqual([]);
  });
});

describe("status --verify (end to end)", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeInstalledPlugins(["a@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "a@mp": true } });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("is accepted as a flag", async () => {
    const result = await h.run(["status", "--verify"]);

    expect(result.output).not.toContain("ERR_PARSE_ARGS_UNKNOWN_OPTION");
  });

  /**
   * `claude plugin list --json` always resolves the full local > project > user chain for the
   * directory it runs in. The reporter now covers that same whole chain whatever scope is audited,
   * so --verify is valid — and identical — at all three. An earlier version compared a truncated
   * set, which fabricated drift and had to be restricted to `local`.
   */
  it.each(["local", "project", "user"])("is accepted at --scope %s", async (scope) => {
    await h.writeSettings("local", { enabledPlugins: { "jdtls@mp": true } });

    const result = await h.run(["status", "--verify", "--scope", scope]);

    expect(result.stderr).not.toContain("only supported with --scope local");
    expect(result.output).not.toContain("ERR_PARSE_ARGS_UNKNOWN_OPTION");
  });

  it("does not fail the run when claude is unreachable — the env here has no PATH", async () => {
    // A verification that cannot run is a warning, not drift: it must not turn a clean audit into
    // a non-zero exit, or `status --verify` would be unusable in CI images without the CLI.
    const result = await h.run(["status", "--verify"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Could not verify");
  });
});

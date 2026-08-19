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

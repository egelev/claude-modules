import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applicableScopes, Scope } from "../src/core/types.js";
import { Harness } from "./helpers/harness.js";

describe("applicableScopes", () => {
  it("is the full chain, most specific first, inside a repository", () => {
    expect(applicableScopes(true)).toEqual([Scope.Local, Scope.Project, Scope.User]);
  });

  it("is local + user outside a repository — local needs no repository", () => {
    expect(applicableScopes(false)).toEqual([Scope.Local, Scope.User]);
  });
});

/**
 * The invariant that makes `status --verify` valid at every scope: what a session loads is decided
 * by the whole precedence chain, so the report must cover the whole chain no matter which scope is
 * being audited. `--scope` picks the *subject* of the audit, not how much of reality to show.
 */
describe("the report covers every scope in effect, whatever scope is audited", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeInstalledPlugins(["local-only@mp", "project-only@mp", "user-only@mp", "suppressed@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "local-only@mp": true, "suppressed@mp": false } });
    await h.writeSettings("project", { enabledPlugins: { "project-only@mp": true } });
    await h.writeSettings("user", { enabledPlugins: { "user-only@mp": true, "suppressed@mp": true } });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it.each(["local", "project", "user"])("names all three scopes at --scope %s", async (scope) => {
    const result = await h.run(["status", "--scope", scope]);

    expect(result.stdout).toContain("(local)");
    expect(result.stdout).toContain("(project)");
    expect(result.stdout).toContain("(user)");
  });

  it.each(["local", "project", "user"])("lists every effectively-enabled plugin at --scope %s", async (scope) => {
    const result = await h.run(["status", "--scope", scope]);

    expect(result.stdout).toContain("local-only@mp");
    expect(result.stdout).toContain("project-only@mp");
    expect(result.stdout).toContain("user-only@mp");
  });

  it.each(["local", "project", "user"])(
    "annotates a user plugin the local scope overrides, at --scope %s",
    async (scope) => {
      // Previously invisible when auditing `user`: local was never read, so the report claimed
      // suppressed@mp was enabled when a session would never load it.
      const result = await h.run(["status", "--scope", scope]);

      expect(result.stdout).toContain("(user — overridden by local)");
    }
  );

  it("does not report an overridden plugin as uncached, even when auditing the scope that enables it", async () => {
    // suppressed@mp is deliberately absent from the cache below; it must not be flagged, because
    // local disables it and it will never load.
    await h.writeInstalledPlugins(["local-only@mp", "project-only@mp", "user-only@mp"]);

    const result = await h.run(["status", "--scope", "user"]);

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("suppressed@mp");
  });

  it("prints one consolidated list with each plugin tagged by its own scope", async () => {
    const result = await h.run(["status", "--scope", "project"]);

    expect(result.stdout.match(/Enabled plugin\(s\):/g)).toHaveLength(1);
    expect(result.stdout).toContain("project-only@mp (project)");
    expect(result.stdout).toContain("local-only@mp (local)");
    expect(result.stdout).toContain("user-only@mp (user)");
  });
});

describe("outside a repository", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeInstalledPlugins(["markets@mp", "cli-tool@mp"]);
    await h.writeSettings("user", { enabledPlugins: { "markets@mp": true } });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("reports user and local scope, but not project — project has no file to resolve", async () => {
    // local needs no repository (Claude Code reads .claude/settings.local.json from cwd either
    // way), so it's still part of the chain here; project is meant to be shared via a repository.
    // Give local an actual entry — an empty scope now contributes zero lines to the consolidated
    // report, so there'd otherwise be nothing to observe proving local was included at all.
    await h.writeFileAt(
      ".claude/settings.local.json",
      JSON.stringify({ enabledPlugins: { "cli-tool@mp": true } }),
      h.nonRepoDir
    );

    const result = await h.run(["status", "--scope", "user"], h.nonRepoDir);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("(user)");
    expect(result.stdout).toContain("(local)");
    expect(result.stdout).not.toContain("(project)");
  });
});

describe("mutating commands report the full chain too", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("investing", { enabledPlugins: { "markets@mp": true }, extraKnownMarketplaces: {} });
    await h.writeInstalledPlugins(["markets@mp", "repo-tool@mp"]);
    await h.writeSettings("local", { enabledPlugins: { "repo-tool@mp": true } });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("enable --scope user inside a repo shows what local still contributes", async () => {
    // Intentional output change: `report` is shared with enable/disable, so a global mode switch
    // now surfaces the repo-scoped plugins that will load alongside it.
    const result = await h.run(["enable", "investing", "--scope", "user"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Enabled plugin(s):");
    expect(result.stdout).toContain("markets@mp (user)");
    expect(result.stdout).toContain("repo-tool@mp (local)");
  });

  it("--only explains that it leaves more-specific scopes alone", async () => {
    const result = await h.run(["enable", "investing", "--scope", "project", "--only"]);

    expect(result.stdout).toContain("--only overrides broader scopes only");
    expect(result.stdout).toContain("local");
  });

  it("--only still names local as more-specific outside a repository — local needs no repository", async () => {
    // Intentional: local is always applicable now (it falls back to cwd), so --only's
    // "more-specific scopes" check finds it here even without a git repository.
    const result = await h.run(["enable", "investing", "--scope", "user", "--only"], h.nonRepoDir);

    expect(result.stdout).toContain("--only overrides broader scopes only");
    expect(result.stdout).toContain("local");
  });
});

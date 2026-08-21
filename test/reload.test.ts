import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { Harness, githubSource } from "./helpers/harness.js";

describe("reload", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("backend", { enabledPlugins: { "jdtls@mp": true }, extraKnownMarketplaces: {} });
    await h.writeModule("frontend", { enabledPlugins: { "playwright@mp": true }, extraKnownMarketplaces: {} });
    await h.writeInstalledPlugins(["jdtls@mp", "playwright@mp"]);
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("re-applies the saved module list", async () => {
    await h.writeFileAt(".claude-modules.local", "backend\nfrontend\n");

    const result = await h.run(["reload"]);

    expect(result.code).toBe(0);
    const settings = await h.readSettings("local");
    expect(settings.enabledPlugins).toEqual({ "jdtls@mp": true, "playwright@mp": true });
  });

  it("finds the list file by walking up from a subdirectory", async () => {
    await h.writeFileAt(".claude-modules.local", "backend\n");
    const nested = join(h.repoRoot, "a", "b", "c");
    await mkdir(nested, { recursive: true });

    const result = await h.run(["reload"], nested);

    expect(result.code).toBe(0);
    expect((await h.readSettings("local")).enabledPlugins).toHaveProperty("jdtls@mp", true);
  });

  it("ignores comments and blank lines in the list file", async () => {
    await h.writeFileAt(".claude-modules.local", "# roles for this repo\n\nbackend\n\n");

    const result = await h.run(["reload"]);

    expect(result.code).toBe(0);
    expect((await h.readSettings("local")).enabledPlugins).toEqual({ "jdtls@mp": true });
  });

  it("reads an explicit --file, no repository required", async () => {
    const listPath = join(h.nonRepoDir, "team.list");
    await h.writeFileAt("team.list", "backend\n", h.nonRepoDir);

    const result = await h.run(["reload", "--scope", "user", "--file", listPath], h.nonRepoDir);

    expect(result.code).toBe(0);
    expect((await h.readSettings("user")).enabledPlugins).toHaveProperty("jdtls@mp", true);
  });

  it("errors when no list file exists in the repository", async () => {
    const result = await h.run(["reload"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No module list found for local scope");
  });

  it("errors when --file points at nothing", async () => {
    const result = await h.run(["reload", "--file", "./missing.list"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No such file");
  });

  it("names the list file when a listed module was since removed, rather than a bare 'does not exist'", async () => {
    await h.writeFileAt(".claude-modules.local", "backend\nghost\n");

    const result = await h.run(["reload"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Module 'ghost' does not exist");
    expect(result.stderr).toContain(".claude-modules.local");
    expect(result.stderr).toContain("edit that file");
  });

  it("reports a still-missing plugin and points at --install, now that reload defaults install to false like enable", async () => {
    // reload used to always attempt the install-cache step (hardcoded install: true). It now
    // defaults to false, same as enable, and takes its own --install flag — so a plain reload gets
    // the same "Run with --install" hint enable (without --install) already gets.
    await h.writeModule("uncached", { enabledPlugins: { "uncached@mp": true }, extraKnownMarketplaces: {} });
    await h.writeFileAt(".claude-modules.local", "uncached\n");

    const result = await h.run(["reload"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Plugin(s) not cached by Claude Code:");
    expect(result.output).toContain("Run with --install");
  });
});

describe("reload --install", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("uncached", {
      enabledPlugins: { "uncached@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
    });
    // Deliberately left out of Claude Code's own cache — this is what exercises the "still not
    // cached" path.
    await h.writeInstalledPlugins([]);
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("never shells out to claude without --install", async () => {
    await h.writeFileAt(".claude-modules.local", "uncached\n");

    const result = await h.run(["reload"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Plugin(s) not cached by Claude Code:");
    expect(result.stdout).toContain("claude plugin install uncached@mp --scope user -y");
    expect(result.stdout).toContain("Run with --install");
    expect(result.output).not.toContain("installed it now");
    expect(result.output).not.toContain("Failed to install");
  });

  it("exits 2 when --install can't fix it because the marketplace is unknown to Claude Code — full symmetry with enable --install", async () => {
    // Mirrors test/enable.test.ts's "exits 2 when --install can't fix it because the marketplace is
    // unknown to Claude Code": with the marketplace unknown, both the marketplace-add and
    // plugin-install paths fail (no real 'claude' on PATH in this harness), and reload --install now
    // fails the run for it, same as enable --install.
    await h.writeFileAt(".claude-modules.local", "uncached\n");

    const result = await h.run(["reload", "--install"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("still not cached by Claude Code after --install");
    expect(result.stderr).toContain("isn't in its known_marketplaces.json either");
    expect(result.stderr).toContain("still not known to Claude Code after --install");
    expect(result.stderr).toContain("Failed to add marketplace");
  });

  it("exits 0 with --install when the only missing marketplace has a source this tool can't convert to a CLI spec", async () => {
    await h.writeModule("odd-source", {
      enabledPlugins: {},
      extraKnownMarketplaces: { odd: { nope: true } },
    });
    await h.writeFileAt(".claude-modules.local", "odd-source\n");

    const result = await h.run(["reload", "--install"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("isn't a shape this tool can");
  });

  it("exits 2 when --install can't fix it because claude is unreachable", async () => {
    // The marketplace is known this time, so the plugin-install attempt proceeds past that check
    // into runClaude — which fails here because the harness's env never sets PATH.
    await h.writeKnownMarketplaces({ mp: githubSource("owner/repo") });
    await h.writeFileAt(".claude-modules.local", "uncached\n");

    const result = await h.run(["reload", "--install"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("'claude' not found on PATH");
  });

  it("exits 0 with --install when nothing ends up missing", async () => {
    await h.writeModule("backend", { enabledPlugins: { "jdtls@mp": true }, extraKnownMarketplaces: {} });
    await h.writeInstalledPlugins(["jdtls@mp"]);
    await h.writeFileAt(".claude-modules.local", "backend\n");

    const result = await h.run(["reload", "--install"]);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("Plugin(s) not cached by Claude Code:");
  });

  it("suppresses the exit-2 failure under --dry-run, since nothing was actually attempted", async () => {
    await h.writeFileAt(".claude-modules.local", "uncached\n");

    const result = await h.run(["reload", "--install", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("[dry-run]");
    expect(result.stdout).toContain("nothing was actually run");
    expect(result.stderr).not.toContain("Error:");
  });

  it("does not fail on an uncached plugin from a broader scope that this run didn't touch", async () => {
    // The exit-2 check must be scoped to this run's own union, not the whole report: a plugin left
    // uncached by some unrelated command, in a scope this module selection never mentions, isn't
    // this run's failure to report.
    await h.writeModule("cachedonly", { enabledPlugins: { "a@mp": true }, extraKnownMarketplaces: {} });
    await h.writeInstalledPlugins(["a@mp"]);
    await h.writeSettings("user", { enabledPlugins: { "other@mp": true } });
    await h.writeFileAt(".claude-modules.local", "cachedonly\n");

    const result = await h.run(["reload", "--install"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Plugin(s) not cached by Claude Code:");
    expect(result.stdout).toContain("other@mp");
  });
});

/**
 * Composition is re-expanded fresh on every `resolve()` call, never saved as an expanded set —
 * `enable --save` only writes the composite module's own name (see
 * module-composability.plan.md §3). So editing what a composed module contributes must be picked
 * up by `status`/`reload` without re-running `--save`.
 */
describe("reload/status with a composite module", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("base", { enabledPlugins: { "jdtls@mp": true }, extraKnownMarketplaces: {} });
    await h.writeModule("frontend", {
      enabledPlugins: { "playwright@mp": true },
      extraKnownMarketplaces: {},
      composedModules: ["base"],
    });
    await h.writeInstalledPlugins(["jdtls@mp", "playwright@mp"]);
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("status reports no drift right after saving a composite module", async () => {
    await h.run(["enable", "frontend", "--save"]);

    const result = await h.run(["status"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("In sync");
  });

  it("status reports drift once the composed module gains a plugin, with no re-save", async () => {
    await h.run(["enable", "frontend", "--save"]);
    await h.writeModule("base", {
      enabledPlugins: { "jdtls@mp": true, "eslint@mp": true },
      extraKnownMarketplaces: {},
    });

    const result = await h.run(["status"]);

    expect(result.stdout).toContain("Missing");
    expect(result.stdout).toContain("eslint@mp");
  });

  it("reload re-expands the composed module fresh and picks up its new plugin", async () => {
    await h.run(["enable", "frontend", "--save"]);
    await h.writeModule("base", {
      enabledPlugins: { "jdtls@mp": true, "eslint@mp": true },
      extraKnownMarketplaces: {},
    });
    await h.writeInstalledPlugins(["jdtls@mp", "playwright@mp", "eslint@mp"]);

    const result = await h.run(["reload"]);

    expect(result.code).toBe(0);
    expect((await h.readSettings("local")).enabledPlugins).toEqual({
      "jdtls@mp": true,
      "playwright@mp": true,
      "eslint@mp": true,
    });
  });
});

/**
 * The weekend-investing case: a set of plugins that isn't tied to any repository. The user-scope
 * list has one fixed home under `$CLAUDE_MODULES_HOME`, so it round-trips from any directory —
 * including outside a repo, and without dropping anything into whatever directory `enable` ran in.
 */
describe("reload outside a git repository", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    await h.writeModule("investing", {
      enabledPlugins: { "markets@mp": true },
      extraKnownMarketplaces: {},
    });
    await h.writeInstalledPlugins(["markets@mp"]);
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("round-trips enable --save and reload with no repository", async () => {
    const enabled = await h.run(["enable", "investing", "--scope", "user", "--save"], h.nonRepoDir);
    expect(enabled.code).toBe(0);
    // The list belongs to the tool's own home, not whatever directory this happened to run in.
    expect(await h.readModuleList("user")).toBe("investing\n");

    const reloaded = await h.run(["reload", "--scope", "user"], h.nonRepoDir);

    expect(reloaded.code).toBe(0);
    expect((await h.readSettings("user")).enabledPlugins).toEqual({ "markets@mp": true });
  });

  it("reloads the user list from any directory, not just where enable ran", async () => {
    await h.run(["enable", "investing", "--scope", "user", "--save"], h.nonRepoDir);

    // A fixed global location means the cwd is irrelevant — the old cwd-anchored file was only
    // findable from the exact directory that wrote it.
    const reloaded = await h.run(["reload", "--scope", "user"], h.repoRoot);

    expect(reloaded.code).toBe(0);
    expect((await h.readSettings("user")).enabledPlugins).toEqual({ "markets@mp": true });
  });

  it("does not leave a module list inside the repository when saving at user scope", async () => {
    // The reported bug: a stray .claude-modules in the repo that local-scope reload/status then
    // picked up by upward search.
    await h.run(["enable", "investing", "--scope", "user", "--save"], h.repoRoot);

    expect(await h.moduleListExists("local")).toBe(false);
    expect(await h.moduleListExists("project")).toBe(false);
    expect(await h.moduleListExists("user")).toBe(true);
  });

  it("still errors helpfully when there is no list file and no repository", async () => {
    const result = await h.run(["reload", "--scope", "user"], h.nonRepoDir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No module list found for user scope");
  });

  it("round-trips enable --save and reload at local scope with no repository", async () => {
    // Exercises ModuleListFile's cwd fallback directly: --save must write where find() will
    // actually look, both anchored on h.nonRepoDir since there's no repository to walk up to.
    const enabled = await h.run(["enable", "investing", "--save"], h.nonRepoDir);
    expect(enabled.code).toBe(0);
    expect(await h.readFileAt(".claude-modules.local", h.nonRepoDir)).toBe("investing\n");

    const reloaded = await h.run(["reload"], h.nonRepoDir);

    expect(reloaded.code).toBe(0);
    const settings = JSON.parse(await h.readFileAt(".claude/settings.local.json", h.nonRepoDir)) as {
      enabledPlugins?: Record<string, boolean>;
    };
    expect(settings.enabledPlugins).toEqual({ "markets@mp": true });
  });

  it("still errors helpfully when there is no list file and no repository, at local scope", async () => {
    const result = await h.run(["reload"], h.nonRepoDir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No module list found for local scope");
    expect(result.stderr).toContain(`in ${h.nonRepoDir}`);
  });
});

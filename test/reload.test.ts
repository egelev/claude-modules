import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { Harness } from "./helpers/harness.js";

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

  it("re-applies the persisted module list", async () => {
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

  it("reports a still-missing plugin without ever mentioning --install, which reload has no flag for", async () => {
    // reload always attempts the install-cache step (hardcoded install: true — see
    // ApplyModulesUseCase.run), unlike enable, where --install is opt-in. The "not cached" block is
    // shared code, so its wording must stay generic here: reload has no --install flag to point at.
    await h.writeModule("uncached", { enabledPlugins: { "uncached@mp": true }, extraKnownMarketplaces: {} });
    await h.writeFileAt(".claude-modules.local", "uncached\n");

    const result = await h.run(["reload"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Plugin(s) not cached by Claude Code:");
    expect(result.output).not.toContain("--install");
  });
});

/**
 * Composition is re-expanded fresh on every `resolve()` call, never persisted as an expanded set —
 * `enable --persist` only writes the composite module's own name (see
 * module-composability.plan.md §3). So editing what a composed module contributes must be picked
 * up by `status`/`reload` without re-running `--persist`.
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

  it("status reports no drift right after persisting a composite module", async () => {
    await h.run(["enable", "frontend", "--persist"]);

    const result = await h.run(["status"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("In sync");
  });

  it("status reports drift once the composed module gains a plugin, with no re-persist", async () => {
    await h.run(["enable", "frontend", "--persist"]);
    await h.writeModule("base", {
      enabledPlugins: { "jdtls@mp": true, "eslint@mp": true },
      extraKnownMarketplaces: {},
    });

    const result = await h.run(["status"]);

    expect(result.stdout).toContain("Missing");
    expect(result.stdout).toContain("eslint@mp");
  });

  it("reload re-expands the composed module fresh and picks up its new plugin", async () => {
    await h.run(["enable", "frontend", "--persist"]);
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

  it("round-trips enable --persist and reload with no repository", async () => {
    const enabled = await h.run(["enable", "investing", "--scope", "user", "--persist"], h.nonRepoDir);
    expect(enabled.code).toBe(0);
    // The list belongs to the tool's own home, not whatever directory this happened to run in.
    expect(await h.readModuleList("user")).toBe("investing\n");

    const reloaded = await h.run(["reload", "--scope", "user"], h.nonRepoDir);

    expect(reloaded.code).toBe(0);
    expect((await h.readSettings("user")).enabledPlugins).toEqual({ "markets@mp": true });
  });

  it("reloads the user list from any directory, not just where enable ran", async () => {
    await h.run(["enable", "investing", "--scope", "user", "--persist"], h.nonRepoDir);

    // A fixed global location means the cwd is irrelevant — the old cwd-anchored file was only
    // findable from the exact directory that wrote it.
    const reloaded = await h.run(["reload", "--scope", "user"], h.repoRoot);

    expect(reloaded.code).toBe(0);
    expect((await h.readSettings("user")).enabledPlugins).toEqual({ "markets@mp": true });
  });

  it("does not leave a module list inside the repository when persisting at user scope", async () => {
    // The reported bug: a stray .claude-modules in the repo that local-scope reload/status then
    // picked up by upward search.
    await h.run(["enable", "investing", "--scope", "user", "--persist"], h.repoRoot);

    expect(await h.moduleListExists("local")).toBe(false);
    expect(await h.moduleListExists("project")).toBe(false);
    expect(await h.moduleListExists("user")).toBe(true);
  });

  it("still errors helpfully when there is no list file and no repository", async () => {
    const result = await h.run(["reload", "--scope", "user"], h.nonRepoDir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No module list found for user scope");
  });

  it("round-trips enable --persist and reload at local scope with no repository", async () => {
    // Exercises ModuleListFile's cwd fallback directly: --persist must write where find() will
    // actually look, both anchored on h.nonRepoDir since there's no repository to walk up to.
    const enabled = await h.run(["enable", "investing", "--persist"], h.nonRepoDir);
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

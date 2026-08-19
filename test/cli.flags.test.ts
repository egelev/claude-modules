import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness, githubSource } from "./helpers/harness.js";

/**
 * Every command, exercised with the two options `GLOBAL_HELP` advertises as global (`--verbose`,
 * `--dry-run`) plus `--help`. A command is allowed to *fail* here (`reload` with no
 * `.claude-modules` file legitimately errors) — what it must never do is surface a raw Node
 * `parseArgs` TypeError, which is what happens when an option isn't declared in that command's
 * own options object.
 */
const COMMANDS: { name: string; argv: string[] }[] = [
  { name: "list", argv: ["list"] },
  { name: "info", argv: ["info", "demo"] },
  { name: "create", argv: ["create", "fresh"] },
  { name: "remove", argv: ["remove", "demo"] },
  { name: "plugin install", argv: ["plugin", "install", "p@mp", "--module", "demo"] },
  { name: "plugin uninstall", argv: ["plugin", "uninstall", "p@mp", "--module", "demo"] },
  { name: "marketplace add", argv: ["marketplace", "add", "owner/repo"] },
  { name: "marketplace remove", argv: ["marketplace", "remove", "mp"] },
  { name: "enable", argv: ["enable", "demo"] },
  { name: "disable", argv: ["disable", "demo"] },
  { name: "disable-all", argv: ["disable-all"] },
  { name: "reload", argv: ["reload"] },
  { name: "status", argv: ["status"] },
];

describe("global flags are accepted by every command", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
    // A module and a marketplace so most commands have something real to act on; the assertions
    // below are about argument parsing, not about these commands' happy paths.
    await h.writeModule("demo", {
      enabledPlugins: { "p@mp": true },
      extraKnownMarketplaces: { mp: githubSource("owner/repo") },
    });
    await h.writeKnownMarketplaces({ mp: { source: { source: "github", repo: "owner/repo" } } });
    await h.writeInstalledPlugins(["p@mp"]);
    await h.writeFileAt(".claude-modules.local", "demo\n");
  });

  afterEach(async () => {
    await h.cleanup();
  });

  for (const { name, argv } of COMMANDS) {
    it(`${name} --help prints usage and exits 0`, async () => {
      const result = await h.run([...argv, "--help"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Usage: claude-modules");
    });

    it(`${name} accepts --verbose without a parseArgs crash`, async () => {
      const result = await h.run([...argv, "--verbose"]);
      expect(result.output).not.toContain("ERR_PARSE_ARGS_UNKNOWN_OPTION");
      expect(result.output).not.toContain("node:internal");
    });

    it(`${name} accepts --dry-run without a parseArgs crash`, async () => {
      const result = await h.run([...argv, "--dry-run"]);
      expect(result.output).not.toContain("ERR_PARSE_ARGS_UNKNOWN_OPTION");
      expect(result.output).not.toContain("node:internal");
    });
  }
});

describe("command groups (marketplace/plugin)", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("marketplace --help prints group usage and exits 0", async () => {
    const result = await h.run(["marketplace", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: claude-modules marketplace");
  });

  it("plugin --help prints group usage and exits 0", async () => {
    const result = await h.run(["plugin", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: claude-modules plugin");
  });

  it("bare 'marketplace' with no subcommand prints the same group usage", async () => {
    const result = await h.run(["marketplace"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: claude-modules marketplace");
  });

  it("a leading flag before any subcommand is treated as 'no subcommand given'", async () => {
    const result = await h.run(["plugin", "--verbose"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: claude-modules plugin");
  });

  it("a subcommand's own --help is distinct from its group's help", async () => {
    const result = await h.run(["marketplace", "add", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: claude-modules marketplace add <spec>");
    expect(result.stdout).not.toContain("Subcommands:");
  });

  it("an unknown subcommand under a group is a clean CLI error naming the group", async () => {
    const result = await h.run(["marketplace", "frobnicate"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown subcommand 'frobnicate' for 'marketplace'");
  });

  it("--dry-run on a nested command still prints the preview banner", async () => {
    const result = await h.run(["plugin", "install", "p@mp", "--module", "demo", "--dry-run"]);
    expect(result.output).toContain("[dry-run]");
    expect(result.output).toContain("Preview mode");
  });

  it("the old flat command names no longer work", async () => {
    const result = await h.run(["add-marketplace", "owner/repo"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown command 'add-marketplace'");
  });
});

describe("malformed arguments produce a clean CLI error", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("reports an unknown option without leaking a Node stack trace", async () => {
    const result = await h.run(["list", "--no-such-option"]);
    expect(result.code).toBe(1);
    expect(result.output).not.toContain("node:internal");
    expect(result.output).not.toContain("ERR_PARSE_ARGS_UNKNOWN_OPTION");
    expect(result.stderr).toContain("--no-such-option");
    expect(result.stderr).toContain("--help");
  });

  it("reports an unknown command", async () => {
    const result = await h.run(["frobnicate"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown command 'frobnicate'");
  });
});

describe("--version", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("prints the package version and exits 0", async () => {
    const result = await h.run(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

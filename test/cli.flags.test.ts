import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMMAND_GROUPS, MUTATING_COMMANDS } from "../src/cli/Cli.js";
import { COMMAND_HELP, GROUP_HELP } from "../src/cli/help.js";
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
  { name: "export", argv: ["export", "demo"] },
  { name: "import", argv: ["import", "nope.tar.gz"] },
  { name: "plugin install", argv: ["plugin", "install", "demo", "p@mp"] },
  { name: "plugin uninstall", argv: ["plugin", "uninstall", "demo", "p@mp"] },
  { name: "marketplace add", argv: ["marketplace", "add", "owner/repo"] },
  { name: "marketplace remove", argv: ["marketplace", "remove", "mp"] },
  { name: "marketplace list", argv: ["marketplace", "list"] },
  { name: "compose add", argv: ["compose", "add", "demo", "demo"] },
  { name: "compose remove", argv: ["compose", "remove", "demo", "demo"] },
  { name: "enable", argv: ["enable", "demo"] },
  { name: "disable", argv: ["disable", "demo"] },
  { name: "disable-all", argv: ["disable-all"] },
  { name: "reload", argv: ["reload"] },
  { name: "update", argv: ["update", "demo"] },
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

  it("create --help points at 'compose add' for changing composition later, not hand-editing", async () => {
    const result = await h.run(["create", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("compose add");
    expect(result.stdout).not.toContain("hand-editing settings.json directly");
  });

  it("an unknown subcommand under a group is a clean CLI error naming the group", async () => {
    const result = await h.run(["marketplace", "frobnicate"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown subcommand 'frobnicate' for 'marketplace'");
  });

  // 'compose' gets the same group-dispatch treatment as 'marketplace'/'plugin' above — it's the
  // newest of the three groups and had no direct coverage of its own bare/help/unknown-subcommand
  // dispatch, only of its subcommands' own behavior (see compose.test.ts).
  it("compose --help prints group usage and exits 0", async () => {
    const result = await h.run(["compose", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: claude-modules compose");
  });

  it("bare 'compose' with no subcommand prints the same group usage", async () => {
    const result = await h.run(["compose"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: claude-modules compose");
  });

  it("an unknown subcommand under 'compose' is a clean CLI error naming the group", async () => {
    const result = await h.run(["compose", "frobnicate"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown subcommand 'frobnicate' for 'compose'");
  });

  it("--dry-run on a nested command still prints the preview banner", async () => {
    const result = await h.run(["plugin", "install", "demo", "p@mp", "--dry-run"]);
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

  it("'-v' is the same short alias as --version", async () => {
    const result = await h.run(["-v"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("'version' is the same bare-command alias as --version", async () => {
    const result = await h.run(["version"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("global help aliases", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("bare invocation with no arguments prints global help and exits 0", async () => {
    const result = await h.run([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: claude-modules");
  });

  it("'help' is the same bare-command alias as --help", async () => {
    const result = await h.run(["help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: claude-modules");
  });

  it("'-h' is the same short alias as --help", async () => {
    const result = await h.run(["-h"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: claude-modules");
  });
});

describe("help tables stay in sync with the dispatch table", () => {
  // Set equality, not a one-way loop over COMMANDS: a new dispatch key that gets a COMMAND_HELP
  // entry (which it must — otherwise '--help' silently falls through to running the command for
  // real) but no COMMANDS row would be invisible to a loop keyed off COMMANDS alone. Comparing the
  // full sets catches drift in either direction.
  it("COMMANDS (the --help/--verbose/--dry-run sweep above) covers exactly the dispatch keys that have help text", () => {
    expect(new Set(COMMANDS.map((c) => c.name))).toEqual(new Set(Object.keys(COMMAND_HELP)));
  });

  it("every command group has a GROUP_HELP entry", () => {
    for (const group of Object.keys(COMMAND_GROUPS)) {
      expect(GROUP_HELP[group], `GROUP_HELP is missing an entry for '${group}'`).toBeDefined();
    }
  });

  it("every MUTATING_COMMANDS entry is a real dispatch key", () => {
    // Checked against COMMAND_HELP's keys (verified elsewhere to be exactly the 18 real dispatch
    // keys), not COMMANDS — a typo here (e.g. "compose-add") would otherwise silently drop that
    // command's --dry-run banner with no test failing anywhere.
    for (const key of MUTATING_COMMANDS) {
      expect(COMMAND_HELP[key], `MUTATING_COMMANDS has '${key}', which isn't a real dispatch key`).toBeDefined();
    }
  });
});

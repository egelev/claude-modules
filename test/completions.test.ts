import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness } from "./helpers/harness.js";

describe("completions", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await Harness.create();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("bash prints a script that registers a bash completion function", async () => {
    const result = await h.run(["completions", "bash"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("complete -F");
    expect(result.stdout).toContain("claude-modules");
    expect(result.stdout).toContain("enable");
    expect(result.stdout).toContain("--from-scope");
    expect(result.stdout).toContain("--verify");
  });

  it("zsh prints a script that registers a zsh completion function", async () => {
    const result = await h.run(["completions", "zsh"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("#compdef claude-modules");
    expect(result.stdout).toContain("$+functions[compdef]");
    expect(result.stdout).toContain("enable");
    expect(result.stdout).toContain("--from-scope");
    expect(result.stdout).toContain("--verify");
  });

  it("requires the shell argument", async () => {
    const result = await h.run(["completions"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Missing required argument");
    expect(result.stderr).toContain("completions --help");
  });

  it("rejects a shell other than bash/zsh", async () => {
    const result = await h.run(["completions", "fish"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid shell 'fish'. Expected one of: bash, zsh.");
  });
});

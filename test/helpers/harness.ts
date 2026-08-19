import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cli } from "../../src/cli/Cli.js";
import { ClaudeSettings } from "../../src/core/types.js";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Everything written, in the order it was written — for assertions that don't care which stream. */
  output: string;
}

/**
 * A throwaway environment for one test: this tool's home ($CLAUDE_MODULES_HOME) and Claude Code's
 * home ($CLAUDE_CONFIG_DIR) both redirected into a temp directory, plus a temp "repo" whose `.git`
 * marker satisfies `RepoLocator` without shelling out to git.
 *
 * Nothing here touches the real ~/.claude or ~/.claude-modules — every path the tool resolves is
 * derived from these two env vars (see `Paths`).
 */
export class Harness {
  private constructor(
    readonly root: string,
    readonly modulesHome: string,
    readonly claudeHome: string,
    readonly repoRoot: string
  ) {}

  static async create(): Promise<Harness> {
    const root = await mkdtemp(join(tmpdir(), "claude-modules-test-"));
    const modulesHome = join(root, "modules-home");
    const claudeHome = join(root, "claude-home");
    const repoRoot = join(root, "repo");
    await mkdir(modulesHome, { recursive: true });
    await mkdir(claudeHome, { recursive: true });
    await mkdir(join(repoRoot, ".git"), { recursive: true });
    return new Harness(root, modulesHome, claudeHome, repoRoot);
  }

  get env(): NodeJS.ProcessEnv {
    return { CLAUDE_MODULES_HOME: this.modulesHome, CLAUDE_CONFIG_DIR: this.claudeHome };
  }

  /** A directory outside any git repository — for the `--scope user` / non-repo paths. */
  get nonRepoDir(): string {
    return this.root;
  }

  /**
   * Runs the real `Cli` with stdout/stderr captured. `Cli` builds its own `Logger` writing straight
   * to the process streams, so patching `write` is the seam that doesn't require production changes.
   */
  async run(argv: string[], cwd: string = this.repoRoot): Promise<CliResult> {
    const chunks: { stream: "out" | "err"; text: string }[] = [];
    const realOut = process.stdout.write.bind(process.stdout);
    const realErr = process.stderr.write.bind(process.stderr);

    process.stdout.write = ((chunk: unknown) => {
      chunks.push({ stream: "out", text: String(chunk) });
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => {
      chunks.push({ stream: "err", text: String(chunk) });
      return true;
    }) as typeof process.stderr.write;

    let code: number;
    try {
      code = await new Cli(cwd, this.env).run(argv);
    } finally {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
    }

    return {
      code,
      stdout: chunks.filter((c) => c.stream === "out").map((c) => c.text).join(""),
      stderr: chunks.filter((c) => c.stream === "err").map((c) => c.text).join(""),
      output: chunks.map((c) => c.text).join(""),
    };
  }

  /** Canonical persisted-module-list path per scope — the layout `--persist` writes. */
  moduleListPath(scope: "user" | "project" | "local"): string {
    if (scope === "user") return join(this.modulesHome, "user.modules");
    return join(this.repoRoot, scope === "project" ? ".claude-modules" : ".claude-modules.local");
  }

  async readModuleList(scope: "user" | "project" | "local"): Promise<string> {
    return readFile(this.moduleListPath(scope), "utf8");
  }

  async moduleListExists(scope: "user" | "project" | "local"): Promise<boolean> {
    return readFile(this.moduleListPath(scope), "utf8")
      .then(() => true)
      .catch(() => false);
  }

  settingsPath(scope: "user" | "project" | "local"): string {
    if (scope === "user") return join(this.claudeHome, "settings.json");
    return join(this.repoRoot, ".claude", scope === "project" ? "settings.json" : "settings.local.json");
  }

  async writeSettings(scope: "user" | "project" | "local", settings: ClaudeSettings): Promise<void> {
    const path = this.settingsPath(scope);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }

  async readSettings(scope: "user" | "project" | "local"): Promise<ClaudeSettings> {
    return JSON.parse(await readFile(this.settingsPath(scope), "utf8")) as ClaudeSettings;
  }

  async writeModule(name: string, module: unknown): Promise<void> {
    const dir = join(this.modulesHome, "modules", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "settings.json"), `${JSON.stringify(module, null, 2)}\n`, "utf8");
  }

  /** Seeds Claude Code's own plugin cache registry, so `ensureCached` sees these as materialized. */
  async writeInstalledPlugins(pluginKeys: string[]): Promise<void> {
    const dir = join(this.claudeHome, "plugins");
    await mkdir(dir, { recursive: true });
    const plugins = Object.fromEntries(pluginKeys.map((key) => [key, [{ scope: "user" }]]));
    await writeFile(join(dir, "installed_plugins.json"), JSON.stringify({ version: 2, plugins }, null, 2), "utf8");
  }

  async writeKnownMarketplaces(entries: Record<string, unknown>): Promise<void> {
    const dir = join(this.claudeHome, "plugins");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "known_marketplaces.json"), JSON.stringify(entries, null, 2), "utf8");
  }

  async writeFileAt(relativePath: string, contents: string, baseDir: string = this.repoRoot): Promise<string> {
    const path = join(baseDir, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
    return path;
  }

  async readFileAt(relativePath: string, baseDir: string = this.repoRoot): Promise<string> {
    return readFile(join(baseDir, relativePath), "utf8");
  }

  async cleanup(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
}

/** A marketplace source in the shape modules and settings.json both use. */
export function githubSource(repo: string): { source: { source: string; repo: string } } {
  return { source: { source: "github", repo } };
}

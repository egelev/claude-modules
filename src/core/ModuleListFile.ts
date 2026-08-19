import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { atomicWriteFile } from "../util/atomicWrite.js";
import { validateModuleName } from "./moduleName.js";
import { RepoLocator } from "./RepoLocator.js";
import { Scope } from "./types.js";
import { Paths } from "../util/Paths.js";
import { ScopeRequiredError } from "../util/errors.js";

const PROJECT_FILE = ".claude-modules";
const LOCAL_FILE = ".claude-modules.local";
const USER_FILE = "user.modules";

/**
 * The persisted list of module names behind `enable --persist` and `reload` — one file per scope,
 * each living with the thing it describes:
 *
 * | Scope     | File                                |                                             |
 * | --------- | ----------------------------------- | ------------------------------------------- |
 * | `user`    | `$CLAUDE_MODULES_HOME/user.modules` | global, not tied to any repository          |
 * | `project` | `<repoRoot>/.claude-modules`        | shared with the team, meant to be committed |
 * | `local`   | `<repoRoot>/.claude-modules.local`  | personal to this checkout, gitignore it     |
 *
 * They were previously one scope-blind `.claude-modules` found by walking up from the cwd, which
 * produced two bugs: `enable --scope user --persist` dropped a file into whatever directory it ran
 * from — inside a repository, where local-scope `reload`/`status` would then pick it up — and
 * persisting at one repo scope silently overwrote the other's list.
 *
 * This class is the single place that knows the layout; `enable --persist`, `reload`, and
 * `status`'s drift check all resolve through it so they cannot disagree.
 */
export class ModuleListFile {
  constructor(
    private readonly paths: Paths,
    private readonly repoLocator: RepoLocator
  ) {}

  /** Where `--persist` writes for `scope` — the same file `find` reads back. */
  async pathFor(scope: Scope, cwd: string): Promise<string> {
    if (scope === Scope.User) return join(this.paths.home, USER_FILE);

    const root = await this.rootFor(scope, cwd);
    if (!root) throw new ScopeRequiredError(scope);
    return join(root, scope === Scope.Project ? PROJECT_FILE : LOCAL_FILE);
  }

  /**
   * The directory `pathFor`/`find`/`searchDescription` resolve `scope` against: the repository
   * root if one exists, else `cwd` itself for `local` scope (which needs no repository — Claude
   * Code reads `.claude-modules.local`'s companion settings file straight from cwd), else `null`
   * for `project` scope, which is meant to be shared via a repository.
   */
  private async rootFor(scope: Scope, cwd: string): Promise<string | null> {
    const repoRoot = await this.repoLocator.findRepoRoot(cwd);
    if (repoRoot) return repoRoot;
    return scope === Scope.Local ? cwd : null;
  }

  /**
   * Where to read `scope`'s list from, or `null` if it has none — always the same file `pathFor`
   * would write, so `enable --persist` and `reload` cannot disagree.
   *
   * Repo-scoped lists are searched for by walking up from `cwd` to the repository root, so `reload`
   * works from any subdirectory. The user-scope list has one fixed location and no search — the cwd
   * walk is exactly what made it unpredictable before. Outside a repository, `local` degenerates to
   * a single check of `cwd` itself, since `rootFor` returns `cwd` as the (only) root to walk up to.
   */
  async find(scope: Scope, cwd: string): Promise<string | null> {
    if (scope === Scope.User) {
      const path = join(this.paths.home, USER_FILE);
      return (await isFile(path)) ? path : null;
    }

    const root = await this.rootFor(scope, cwd);
    if (!root) return null;
    return this.findUpward(cwd, root, scope === Scope.Project ? PROJECT_FILE : LOCAL_FILE);
  }

  /** Human-readable description of where `find` looks, for "nothing found" errors. */
  async searchDescription(scope: Scope, cwd: string): Promise<string> {
    if (scope === Scope.User) return join(this.paths.home, USER_FILE);
    const root = await this.rootFor(scope, cwd);
    const name = scope === Scope.Project ? PROJECT_FILE : LOCAL_FILE;
    return root && root !== cwd ? `${name}, between ${cwd} and repo root ${root}` : `${name}, in ${cwd}`;
  }

  /** Walks from `startDir` up to (and including) `repoRoot` looking for `fileName`. */
  private async findUpward(startDir: string, repoRoot: string, fileName: string): Promise<string | null> {
    let dir = startDir;
    for (;;) {
      const candidate = join(dir, fileName);
      if (await isFile(candidate)) return candidate;

      if (dir === repoRoot) return null;
      const parentDir = dirname(dir);
      if (parentDir === dir) return null;
      dir = parentDir;
    }
  }

  async read(path: string): Promise<string[]> {
    const raw = await readFile(path, "utf8");
    const names = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    names.forEach(validateModuleName);
    return names;
  }

  /** Resolves an explicit `--persist=<path>` / `--file <path>` against `cwd`. */
  resolveExplicitPath(cwd: string, filePath: string): string {
    return resolve(cwd, filePath);
  }

  /** Writes `moduleNames`, one per line, to `targetPath`. */
  async write(targetPath: string, moduleNames: readonly string[]): Promise<string> {
    moduleNames.forEach(validateModuleName);
    await atomicWriteFile(targetPath, `${moduleNames.join("\n")}\n`);
    return targetPath;
  }
}

async function isFile(path: string): Promise<boolean> {
  return stat(path)
    .then((s) => s.isFile())
    .catch(() => false);
}

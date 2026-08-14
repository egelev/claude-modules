import { join } from "node:path";
import { RepoLocator } from "./RepoLocator.js";
import { Scope } from "./types.js";
import { ScopeRequiredError } from "../util/errors.js";
import { Paths } from "../util/Paths.js";

export interface ResolvedScope {
  scope: Scope;
  settingsPath: string;
  repoRoot: string | null;
}

/** Maps a scope (+ current working directory) to the absolute settings.json path it should read/write. */
export class ScopeResolver {
  constructor(
    private readonly repoLocator: RepoLocator,
    private readonly paths: Paths
  ) {}

  async resolve(scope: Scope, cwd: string): Promise<ResolvedScope> {
    if (scope === Scope.User) {
      return { scope, settingsPath: join(this.paths.claudeHome, "settings.json"), repoRoot: null };
    }

    const repoRoot = await this.repoLocator.findRepoRoot(cwd);
    if (!repoRoot) {
      throw new ScopeRequiredError();
    }

    const settingsPath =
      scope === Scope.Project
        ? join(repoRoot, ".claude", "settings.json")
        : join(repoRoot, ".claude", "settings.local.json");

    return { scope, settingsPath, repoRoot };
  }
}

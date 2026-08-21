import { join } from "node:path";
import { RepoLocator } from "./RepoLocator.js";
import { resolveScopeRoot } from "./scopeRoot.js";
import { applicableScopes, Scope } from "./types.js";
import { ScopeRequiredError } from "../util/errors.js";
import { Paths } from "../util/Paths.js";
import { Logger } from "../util/Logger.js";

export interface ResolvedScope {
  scope: Scope;
  settingsPath: string;
  repoRoot: string | null;
}

/** Maps a scope (+ current working directory) to the absolute settings.json path it should read/write. */
export class ScopeResolver {
  constructor(
    private readonly repoLocator: RepoLocator,
    private readonly paths: Paths,
    private readonly logger: Logger
  ) {}

  async resolve(scope: Scope, cwd: string): Promise<ResolvedScope> {
    if (scope === Scope.User) {
      return { scope, settingsPath: join(this.paths.claudeHome, "settings.json"), repoRoot: null };
    }

    const root = await resolveScopeRoot(this.repoLocator, scope, cwd, this.logger);
    if (!root) {
      throw new ScopeRequiredError(scope);
    }

    return { scope, settingsPath: repoScopePath(scope, root), repoRoot: root };
  }

  /**
   * Every scope in effect at `cwd`, most specific first — `[local, project, user]` inside a
   * repository, `[user]` outside one. Unlike `resolve`, absence of a repository is reported by
   * omitting those scopes rather than throwing, because "which scopes exist here" is a question
   * with an answer everywhere.
   *
   * This is the chain that decides what a session actually loads, so it's what reporting and
   * verification compare against, independent of which scope is being audited.
   */
  async resolveApplicable(cwd: string): Promise<ResolvedScope[]> {
    const repoRoot = await this.repoLocator.findRepoRoot(cwd);
    return applicableScopes(repoRoot !== null).map((scope) =>
      scope === Scope.User
        ? { scope, settingsPath: join(this.paths.claudeHome, "settings.json"), repoRoot }
        : { scope, settingsPath: repoScopePath(scope, repoRoot ?? cwd), repoRoot: repoRoot ?? cwd }
    );
  }
}

function repoScopePath(scope: Scope, repoRoot: string): string {
  return scope === Scope.Project
    ? join(repoRoot, ".claude", "settings.json")
    : join(repoRoot, ".claude", "settings.local.json");
}

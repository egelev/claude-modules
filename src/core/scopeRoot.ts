import { RepoLocator } from "./RepoLocator.js";
import { Scope } from "./types.js";
import { Logger } from "../util/Logger.js";

/**
 * Shared by `ScopeResolver` and `ModuleListFile`: finds the repo root for `scope`/`cwd`, falling
 * back to `cwd` itself for `local` scope when no repository exists (`project` scope has no
 * fallback — `null` means "no root"). `logger` is optional so a caller that wants the fallback to
 * stay silent (as `ModuleListFile` always has) can omit it, while one that wants it announced
 * (`ScopeResolver`) can pass a real one — the two intentionally differ here, not by accident.
 */
export async function resolveScopeRoot(
  repoLocator: RepoLocator,
  scope: Scope.Project | Scope.Local,
  cwd: string,
  logger?: Logger
): Promise<string | null> {
  const repoRoot = await repoLocator.findRepoRoot(cwd);
  if (repoRoot) return repoRoot;
  if (scope !== Scope.Local) return null;
  logger?.warn(`No git repository found; using ${cwd} as the local-scope root.`);
  return cwd;
}

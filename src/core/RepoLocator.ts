import { stat } from "node:fs/promises";
import { dirname, join, parse } from "node:path";

/** Locates the root of the git repository containing a directory, if any. */
export class RepoLocator {
  async findRepoRoot(startDir: string): Promise<string | null> {
    let dir = startDir;
    for (;;) {
      const gitPath = join(dir, ".git");
      const exists = await stat(gitPath)
        .then(() => true)
        .catch(() => false);
      // .git is a directory in a normal checkout, but a file (with "gitdir: ...") in worktrees/submodules.
      if (exists) return dir;

      const parentDir = dirname(dir);
      if (parentDir === dir || dir === parse(dir).root) return null;
      dir = parentDir;
    }
  }
}

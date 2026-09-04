# Contributing

Thanks for taking the time to help improve `claude-modules`.

## Development setup

```bash
npm ci
npm run dev -- list          # run the CLI against ./modules instead of ~/.claude-modules
npm run typecheck            # tsc over src/ and test/ (see note below)
npm test                     # vitest
npm run build                # emit dist/
```

Tests drive the real `Cli` against throwaway temp directories, with both `CLAUDE_MODULES_HOME` and
`CLAUDE_CONFIG_DIR` redirected there — nothing in the suite touches your real `~/.claude`. See
[`test/helpers/harness.ts`](test/helpers/harness.ts).

`npm run typecheck` runs `tsc` twice: once for the build config (`src/` only, matching what ships)
and once for `tsconfig.test.json`, which adds `test/`. Without the second pass, tests keep running
against stale types.

## Pull requests

1. Branch off `main`.
2. Keep the change focused; add or update tests for behaviour changes.
3. Make sure `npm run typecheck`, `npm test`, and `npm run build` pass locally.
4. Open the PR against `main`. CI (typecheck + test on Node 20/22/24, plus a pack-and-install
   smoke test) must be green before merge.

Commit messages: `feat:` / `fix:` / `docs:` / `chore:` prefixes are preferred — the history uses
them and they make the generated release notes readable — but they are not enforced.

## Releasing (maintainers)

Releases are separate from merges — nothing ships automatically. Bump `version` in `package.json`
in a PR, merge it, then draft and publish a GitHub Release with tag `vX.Y.Z` on `main`; the
`Release` workflow does the npm publish. Full steps, plus the one-time repository setup (the
`release` environment, branch protection, Trusted Publishing, Dependabot, Private Vulnerability
Reporting), are in the [**Releasing**](README.md#releasing) section of the README.

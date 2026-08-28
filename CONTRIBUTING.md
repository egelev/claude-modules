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

Releases are separate from merges — nothing ships automatically.

1. Open a PR that bumps `version` in `package.json` (semver). Merge it.
2. On GitHub: **Releases → Draft a new release**. Create a new tag `vX.Y.Z` targeting `main`,
   click **Generate release notes**, and **Publish**.
3. The `Release` workflow checks the tag against `package.json`, re-runs the full suite, and
   publishes to npm via OIDC Trusted Publishing (no token) with a provenance attestation, then
   attaches the tarball to the Release.

Prereleases: tick the "pre-release" box when publishing the Release and it goes out under the
`next` dist-tag instead of `latest`.

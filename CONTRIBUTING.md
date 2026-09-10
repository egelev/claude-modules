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
against stale types — vitest strips types with esbuild and never checks them.

## Pull requests

1. Branch off `main`.
2. Keep the change focused; add or update tests for behaviour changes.
3. Make sure `npm run typecheck`, `npm test`, and `npm run build` pass locally.
4. Open the PR against `main`. CI (typecheck + test on Node 20/22/24, plus a pack-and-install
   smoke test) must be green before merge.

Commit messages: `feat:` / `fix:` / `docs:` / `chore:` prefixes are preferred — the history uses
them and they make the generated release notes readable — but they are not enforced.

## Website

The site in [`website/`](website/) is a zero-dependency static build:
`node website/build.mjs` renders `website/_site/`.

- **`docs.html` is generated from [`docs/`](docs/)** — edit the Markdown there, never the HTML.
  Page order and TOC grouping live in
  [`website/src/docs/manifest.json`](website/src/docs/manifest.json).
- Callout boxes come from GitHub alert blockquotes in the Markdown: `> [!WARNING]` renders as a
  warning, any other `> …` blockquote as a plain note.
- **Installation, Configuration, Global options and Known limitations are _not_ in `docs/`** —
  they're hand-authored in `website/src/docs/intro.html` / `appendix.html` and **must be kept in
  sync with the README** by hand.
- The landing page is `website/src/pages/index.html`; the shared header/footer are
  `website/src/partials/`. See [`website/README.md`](website/README.md) for the full model.

Preview locally:

```bash
node website/build.mjs
python3 -m http.server -d website/_site 8000  # → http://localhost:8000
```

Merging a change under `website/**` or `docs/**` to `main` **publishes automatically** to GitHub
Pages (<https://egelev.github.io/claude-modules/>) via
[`pages.yml`](.github/workflows/pages.yml) — no release or manual step.

## Releasing (maintainers)

Publishing to npm is deliberate and separate from merging — merging to `main` never publishes
anything on its own, and publishing a GitHub Release does *not* trigger anything either.
`.github/workflows/release.yml` is manually triggered (`workflow_dispatch`) and does everything in
one run: tags `main`, builds and tests it, packs and smoke-tests the tarball, opens the GitHub
Release as a **draft**, attaches the tarball, publishes to npm, and only as its last step publishes
the Release itself.

GitHub's [immutable releases](https://github.blog/changelog/2025-10-28-immutable-releases-are-now-generally-available/)
lock a release's assets the instant it's published, so the tarball has to be attached _before_
publish — hence the draft step, done and undone inside the same run.

### Cutting a release

1. **Bump the version in a PR.** Edit `version` in `package.json` following
   [semver](https://semver.org/) — `npm version --no-git-tag-version <patch|minor|major>` does it —
   and merge once CI is green. Nothing publishes yet.
2. **Run the "Release" workflow.** **Actions → Release → Run workflow**, with **Use workflow from:
   main** (or `gh workflow run release.yml --ref main`).
3. **Let it run.** It refuses to run from anything but `main`, fails fast unless the computed tag
   already has no Release, re-runs the full test suite, packs and smoke-tests the tarball, tags and
   pushes `main`, opens the Release as a draft, attaches the `.tgz`, publishes to npm via OIDC, and
   only then publishes the Release itself (making it live and immutable). A normal version goes to
   the `latest` dist-tag; a prerelease version (`X.Y.Z-rc.1`, etc.) is auto-detected from the `-`
   and goes to `next`, so `npm install -g claude-modules` never picks it up.
4. **Approve and verify.** If the `release` environment requires a reviewer, approve the run in the
   **Actions** tab before it starts. Then confirm the new version and its provenance badge on
   [npmjs.com](https://www.npmjs.com/package/claude-modules) (`npm audit signatures` after
   installing also verifies it).

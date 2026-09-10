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

Releases are separate from merges — nothing ships automatically. Bump `version` in `package.json`
in a PR and merge it, then run the **Release** workflow by hand (**Actions → Release → Run
workflow**, from `main`); it tags `main`, publishes to npm, and turns the draft GitHub Release
live as its last step. Publishing a GitHub Release does *not* trigger anything. Full steps, plus
the one-time repository setup (the `release` environment, branch protection, Trusted Publishing,
Dependabot, Private Vulnerability Reporting), are in the
[**Releasing**](README.md#releasing) section of the README.

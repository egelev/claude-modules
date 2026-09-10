# claude-modules website

Static marketing + docs site for `claude-modules`, deployed to GitHub Pages by
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml).

## Layout

```
website/
├── build.mjs              # zero-dependency builder (Node ≥ 20, no npm install)
├── lib/
│   ├── markdown.mjs       # tiny CommonMark-subset renderer
│   └── docs-page.mjs      # assembles docs.html from docs/*.md + the manifest
├── src/
│   ├── layout.html        # HTML skeleton — <head> meta + {{placeholders}}
│   ├── partials/
│   │   ├── header.html    # shared site header / nav
│   │   └── footer.html    # shared site footer + back-to-top + <script>
│   ├── docs/
│   │   ├── manifest.json  # doc order, TOC groups, slug aliases
│   │   ├── intro.html     # hand-authored: Installation + Configuration
│   │   └── appendix.html  # hand-authored: Global options + Known limitations
│   └── pages/
│       ├── index.html     # landing page — <!--meta {…} --> block, then <main>
│       └── docs.html      # thin shell — {{docs_toc}} + {{docs_content}}
├── assets/
│   ├── style.css          # design tokens + ITCSS-layered styles
│   └── main.js            # progressive-enhancement behaviour (no framework)
├── favicon.svg
└── _site/                 # build output — git-ignored, never edited by hand
```

Each page in `src/pages/` starts with a metadata block that feeds the layout:

```html
<!--meta
{
  "title":       "Page title — used in <title>, og:title, twitter:title",
  "description": "Meta description — used in description, og:description, …",
  "path":        "docs.html",  /* appended to the site origin for canonical + og:url; "" for the home page */
  "noindex":     true          /* optional — emits <meta name="robots" content="noindex"> and drops the page from sitemap.xml */
}
-->
```

`build.mjs` also emits, from the same page list:

- `_site/robots.txt` — allows everything, points crawlers at the sitemap
- `_site/sitemap.xml` — one `<loc>` per indexable page (`noindex` pages excluded), `<lastmod>` = build date
- a `schema.org` JSON-LD block in every page's `<head>` (`WebSite` + `WebPage`, plus `SoftwareApplication` on the home page)

## The documentation page is generated

`docs.html`'s body is built from the repo-root [`docs/`](../docs) Markdown folder —
**edit the docs there, not here.** `build.mjs` renders each file listed in
[`src/docs/manifest.json`](src/docs/manifest.json), maps the Markdown onto the site's
components, and assembles the page + its sidebar TOC:

| Markdown | becomes |
| --- | --- |
| fenced code ` ```bash ` / ` ```json ` / ` ``` ` | `.code-block` (head label from the language, or `` ```lang title="…" ``) |
| the code block right after an `##` | also gets `.cmd-sig` |
| `> [!WARNING]` / `> [!CAUTION]` blockquote | `.callout.callout-warn` |
| any other `>` blockquote | `.callout` |
| GFM pipe table | wrapped in `.table-wrap` |
| `## Heading` | `<h2 id="heading">` (GitHub-style slug; `--flag` headings keep the leading `--`) |
| `[text](other.md#anchor)` | `#anchor` — inter-file links collapse to this single page |
| `[text](../README.md#x)` | the README URL on GitHub |

Per file, the leading `# Title`, the `` `cmd` · `cmd` `` line and the
`[← back to README]` breadcrumb are stripped — everything a GitHub reader needs but
the single-page site does not. Thematic breaks (`---`) are dropped.

`Installation`, `Configuration`, `Global options` and `Known limitations` aren't in
`docs/`; they live in `src/docs/intro.html` / `appendix.html` and mirror the README —
keep them in sync by hand.

The build fails if any `#anchor` doesn't resolve — both in-page anchors within
`docs.html` and the `index.html` → `docs.html#…` cross-page links.

## Build & preview

```sh
node website/build.mjs                 # writes website/_site/
python3 -m http.server -d website/_site 8000
```

The deployed site lives at a project path (`…github.io/claude-modules/`), so all
internal links are **relative** (`docs.html`, `assets/…`, `favicon.svg`). To
preview under a matching path, serve one directory up:

```sh
mkdir -p /tmp/preview/claude-modules
cp -r website/_site/. /tmp/preview/claude-modules/
cd /tmp/preview && python3 -m http.server 8000
# → http://localhost:8000/claude-modules/
```

## Editing

- **Documentation content** → [`docs/*.md`](../docs) (the single source of truth)
- **Doc order / TOC groups / slug aliases** → `src/docs/manifest.json`
- **Installation / Configuration / Global options / Known limitations** →
  `src/docs/intro.html` and `src/docs/appendix.html` (mirror the README)
- **Landing-page content** → `src/pages/index.html`
- **Header / footer** → `src/partials/*.html` (edit once, both pages update)
- **`<head>` / meta tags** → `src/layout.html`
- **Design tokens & styles** → `assets/style.css` (all colours, spacing, type,
  radii, shadows, z-index and motion are CSS custom properties in the `:root`
  block at the top; add new values there rather than inline)
- **Behaviour** → `assets/main.js`
- **Social preview** → edit `assets/og-cover.svg`, then regenerate the PNG the
  meta tags actually point at (crawlers, X/Twitter especially, don't take SVG):

  ```sh
  npx @resvg/resvg-js-cli \
    --font-sans-serif-family Inter --font-monospace-family "JetBrains Mono" \
    assets/og-cover.svg assets/og-cover.png
  ```

  Needs Inter + JetBrains Mono installed locally (or pass `--font-file`).
  `assets/og-cover.png` is committed — the build only copies it.

Rebuild with `node website/build.mjs` after any change.

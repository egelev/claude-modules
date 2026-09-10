#!/usr/bin/env node
/*
 * Zero-dependency static builder for the claude-modules website.
 *
 *   node website/build.mjs
 *
 * Reads src/layout.html + src/partials/*.html + src/pages/*.html, assembles each
 * page, and writes the result plus the static assets into _site/.
 * See website/README.md for the authoring model.
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  cpSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocsPage } from './lib/docs-page.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, 'src');
const outDir = join(root, '_site');

/** Canonical origin for <link rel="canonical"> and og:url (trailing slash kept). */
const SITE_URL = 'https://egelev.github.io/claude-modules/';

/** UTC date stamp for <lastmod> in sitemap.xml. */
const BUILD_DATE = new Date().toISOString().slice(0, 10);

const META_RE = /^\s*<!--meta\s*([\s\S]*?)-->\s*/;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadPartials() {
  const dir = join(srcDir, 'partials');
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith('.html'))
      .map((f) => [basename(f, '.html'), readFileSync(join(dir, f), 'utf8').trim()]),
  );
}

/**
 * schema.org JSON-LD for the page's <head>. Every page carries WebSite + WebPage
 * nodes; the home page also describes the CLI itself as a SoftwareApplication.
 * `<` is escaped so the block can't terminate the <script> early.
 */
function buildJsonLd({ title, description, canonical, isHome }) {
  const siteDescription =
    'A plugin manager for Claude Code: bundle plugins into named, composable ' +
    'modules you enable, share, and move between machines with one command.';

  const graph = [
    {
      '@type': 'WebSite',
      '@id': SITE_URL + '#website',
      name: 'claude-modules',
      url: SITE_URL,
      description: siteDescription,
    },
    {
      '@type': 'WebPage',
      url: canonical,
      name: title,
      description,
      isPartOf: { '@id': SITE_URL + '#website' },
    },
  ];

  if (isHome) {
    graph.push({
      '@type': 'SoftwareApplication',
      name: 'claude-modules',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Linux, macOS, Windows',
      url: SITE_URL,
      description: siteDescription,
      softwareHelp: SITE_URL + 'docs.html',
      downloadUrl: 'https://www.npmjs.com/package/claude-modules',
      codeRepository: 'https://github.com/egelev/claude-modules',
      license: 'https://opensource.org/licenses/MIT',
      author: { '@type': 'Person', name: 'Emil Gelev' },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    });
  }

  const json = JSON.stringify(
    { '@context': 'https://schema.org', '@graph': graph },
    null,
    2,
  ).replace(/</g, '\\u003c');

  return `<script type="application/ld+json">\n${json}\n  </script>`;
}

function renderPage(file, layout, partials) {
  const raw = readFileSync(join(srcDir, 'pages', file), 'utf8');
  const meta = META_RE.exec(raw);
  if (!meta) throw new Error(`${file}: missing leading <!--meta { ... } --> block`);

  const { title, description, path, noindex = false } = JSON.parse(meta[1]);
  if (!title || !description || path === undefined) {
    throw new Error(`${file}: meta block needs "title", "description" and "path"`);
  }

  let content = raw.slice(meta[0].length).trimEnd();
  const canonical = SITE_URL + path;
  const ogImage = SITE_URL + 'assets/og-cover.png'; // absolute URL required by OG/Twitter
  // 404.html must never be indexed — search engines would otherwise surface the
  // error page for real queries.
  const robots = noindex ? '  <meta name="robots" content="noindex" />' : '';
  const jsonLd = buildJsonLd({ title, description, canonical, isHome: path === '' });

  // Pages that opt in get their documentation body generated from docs/*.md.
  if (content.includes('{{docs_content}}')) {
    const { toc, content: docsHtml } = buildDocsPage();
    content = content.replaceAll('{{docs_toc}}', toc).replaceAll('{{docs_content}}', docsHtml);
  }

  const html = layout
    .replaceAll('{{header}}', partials.header)
    .replaceAll('{{footer}}', partials.footer)
    .replaceAll('{{content}}', content)
    .replaceAll('{{title}}', escapeHtml(title))
    .replaceAll('{{description}}', escapeHtml(description))
    .replaceAll('{{canonical}}', escapeHtml(canonical))
    .replaceAll('{{robots}}', robots)
    .replaceAll('{{json_ld}}', jsonLd)
    .replaceAll('{{og_image}}', escapeHtml(ogImage))
    // Absolute site root — 404.html can't use relative links (the browser keeps
    // the unknown URL, so `docs.html` would resolve against the wrong path).
    .replaceAll('{{site_url}}', escapeHtml(SITE_URL));

  const leftover = /{{\s*[\w-]+\s*}}/.exec(html);
  if (leftover) throw new Error(`${file}: unresolved placeholder ${leftover[0]}`);

  return { html: html + '\n', path, noindex: Boolean(noindex) };
}

/** robots.txt + sitemap.xml, written straight into the site root. */
function writeCrawlerFiles(indexablePaths) {
  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`;
  writeFileSync(join(outDir, 'robots.txt'), robots);

  const locs = indexablePaths
    .map((p) => SITE_URL + p)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  const urls = locs
    .map((loc) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${BUILD_DATE}</lastmod>\n  </url>`)
    .join('\n');
  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls +
    '\n</urlset>\n';
  writeFileSync(join(outDir, 'sitemap.xml'), sitemap);

  console.log('  write   _site/robots.txt, _site/sitemap.xml');
}

/**
 * Every `href="<page>.html#id"` that targets another built page must resolve to a
 * real id on that page. buildDocsPage() already checks anchors within docs.html;
 * this catches the ~two dozen index.html -> docs.html# links (and the shared
 * header's index.html# links) that nothing else validates. Sets a failing exit
 * code — the deploy step won't run after a non-zero build.
 */
function checkCrossPageAnchors(pages) {
  const idsByPage = Object.fromEntries(
    Object.entries(pages).map(([name, html]) => [
      name,
      new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])),
    ]),
  );

  const broken = new Set();
  for (const [from, html] of Object.entries(pages)) {
    for (const [, target, anchor] of html.matchAll(/href="([\w.-]+\.html)#([^"]+)"/g)) {
      if (idsByPage[target] && !idsByPage[target].has(anchor)) {
        broken.add(`${from} -> ${target}#${anchor}`);
      }
    }
  }

  if (broken.size) {
    console.error(`  links: ${broken.size} broken cross-page anchor(s):`);
    for (const b of broken) console.error(`          ${b}`);
    process.exitCode = 1;
  }
}

function build() {
  const layout = readFileSync(join(srcDir, 'layout.html'), 'utf8');
  const partials = loadPartials();

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const pages = {};
  const indexablePaths = [];
  for (const file of readdirSync(join(srcDir, 'pages')).filter((f) => f.endsWith('.html'))) {
    const { html, path, noindex } = renderPage(file, layout, partials);
    pages[file] = html;
    writeFileSync(join(outDir, file), html);
    if (!noindex) indexablePaths.push(path);
    console.log(`  build   _site/${file}`);
  }

  checkCrossPageAnchors(pages);
  writeCrawlerFiles(indexablePaths);

  cpSync(join(root, 'assets'), join(outDir, 'assets'), { recursive: true });
  cpSync(join(root, 'favicon.svg'), join(outDir, 'favicon.svg'));
  console.log('  copy    _site/assets/, _site/favicon.svg');
}

build();

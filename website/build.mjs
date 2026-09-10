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

function renderPage(file, layout, partials) {
  const raw = readFileSync(join(srcDir, 'pages', file), 'utf8');
  const meta = META_RE.exec(raw);
  if (!meta) throw new Error(`${file}: missing leading <!--meta { ... } --> block`);

  const { title, description, path } = JSON.parse(meta[1]);
  if (!title || !description || path === undefined) {
    throw new Error(`${file}: meta block needs "title", "description" and "path"`);
  }

  let content = raw.slice(meta[0].length).trimEnd();
  const canonical = SITE_URL + path;
  const ogImage = SITE_URL + 'assets/og-cover.png'; // absolute URL required by OG/Twitter

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
    .replaceAll('{{og_image}}', escapeHtml(ogImage))
    // Absolute site root — 404.html can't use relative links (the browser keeps
    // the unknown URL, so `docs.html` would resolve against the wrong path).
    .replaceAll('{{site_url}}', escapeHtml(SITE_URL));

  const leftover = /{{\s*[\w-]+\s*}}/.exec(html);
  if (leftover) throw new Error(`${file}: unresolved placeholder ${leftover[0]}`);

  return html + '\n';
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
  for (const file of readdirSync(join(srcDir, 'pages')).filter((f) => f.endsWith('.html'))) {
    pages[file] = renderPage(file, layout, partials);
    writeFileSync(join(outDir, file), pages[file]);
    console.log(`  build   _site/${file}`);
  }

  checkCrossPageAnchors(pages);

  cpSync(join(root, 'assets'), join(outDir, 'assets'), { recursive: true });
  cpSync(join(root, 'favicon.svg'), join(outDir, 'favicon.svg'));
  console.log('  copy    _site/assets/, _site/favicon.svg');
}

build();

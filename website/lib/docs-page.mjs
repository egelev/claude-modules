/*
 * Assembles the single-page documentation from docs/*.md.
 *
 * Pipeline per source file:
 *   1. stripChrome()   — drop the GitHub-only H1 / command list / breadcrumb
 *   2. renderMarkdown() — Markdown -> plain semantic HTML
 *   3. decorate()      — map that HTML onto the site's components
 *                        (.code-block, .callout, .table-wrap, heading ids)
 *
 * Order, TOC grouping, slug aliases and the two hand-authored partials
 * (Installation/Configuration, Known limitations) come from src/docs/manifest.json.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, escapeHtml, stripTags } from './markdown.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = join(here, '..', '..', 'docs');
const cfgDir = join(here, '..', 'src', 'docs');

/* --------------------------------------------------------------- helpers -- */

// GitHub's heading-slug algorithm: lowercase, drop everything except word
// chars / spaces / hyphens, then spaces -> hyphens. Consecutive hyphens are NOT
// collapsed, so a flag heading like `### `--only`` keeps its leading "--" and
// never collides with the `## `only`` … it wouldn't anyway, but `## `disable``
// vs `### `--disable`` would.
function slugify(text) {
  return stripTags(String(text))
    .replace(/&[a-z]+;/g, '')
    .toLowerCase()
    .replace(/[^\w\- ]+/g, '')
    .replace(/ /g, '-')
    .replace(/-+$/g, '');
}

// Everything up to the first real content line is GitHub-reader chrome:
//   line 1  "# Title"
//   a "`cmd` · `cmd`" command list
//   a "[← back to README](../README.md) · …" breadcrumb (may sit a line or two in)
//   a leading "---" / blank lines
function stripChrome(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const isBreadcrumb = (l) =>
    /README\.md/.test(l) && /^\[.+\]\([^)]*\)(\s*·\s*\[.+\]\([^)]*\))*\s*$/.test(l.trim());
  const isCommandList = (l) => /^`[^`]+`(\s*·\s*`[^`]+`)*$/.test(l.trim());

  const kept = [];
  let started = false;
  lines.forEach((l, idx) => {
    if (isBreadcrumb(l)) return; // breadcrumbs never appear mid-content
    if (!started) {
      if (idx === 0 && /^#\s/.test(l)) return;
      if (/^\s*$/.test(l) || /^-{3,}\s*$/.test(l) || isCommandList(l)) return;
      started = true;
    }
    kept.push(l);
  });
  return kept.join('\n').replace(/^\n+/, '');
}

function labelFor(lang, title) {
  if (title) return title;
  if (!lang) return 'text';
  if (/^(bash|sh|zsh|shell|console)$/i.test(lang)) return 'terminal';
  return lang;
}

const SHELLISH = /^(|bash|sh|zsh|shell|console)$/i;

// Colour `#` comments inside shell code blocks, matching the hand-authored pages.
// `body` is already HTML-escaped by the renderer.
function highlightComments(body, lang) {
  if (!SHELLISH.test(lang || '')) return body;
  return body
    .split('\n')
    .map((ln) => {
      const full = ln.match(/^(\s*)(#.*)$/);
      if (full) return `${full[1]}<span class="tok-comment">${full[2]}</span>`;
      const trailing = ln.match(/^(.*\S)(\s{2,}#\s.*)$/);
      if (trailing && (trailing[1].match(/"/g) || []).length % 2 === 0) {
        return `${trailing[1]}<span class="tok-comment">${trailing[2]}</span>`;
      }
      return ln;
    })
    .join('\n');
}

function makeRewriteLink(aliases, readmeUrl, firstIdByFile) {
  const resolve = (anchor) => aliases[anchor] || anchor;
  return (href) => {
    if (/^https?:/i.test(href) || href.startsWith('mailto:')) return href;

    let m = href.match(/^\.\.\/README\.md(#.+)?$/);
    if (m) return readmeUrl + (m[1] || '#readme');

    m = href.match(/^([\w-]+)\.md(?:#(.+))?$/);
    if (m) {
      if (m[2]) return `#${resolve(m[2])}`;
      return `#${firstIdByFile[`${m[1]}.md`] || ''}`;
    }

    m = href.match(/^#(.+)$/);
    if (m) return `#${resolve(m[1])}`;

    return href;
  };
}

/* --------------------------------------------- HTML -> site components -- */

function decorate(html, { aliases, seenIds, headings }) {
  // 1. heading ids (+ alias + de-dupe)
  html = html.replace(/<(h[234])>([\s\S]*?)<\/\1>/g, (_, tag, inner) => {
    const base = aliases[slugify(inner)] || slugify(inner);
    let id = base;
    for (let k = 2; seenIds.has(id); k++) id = `${base}-${k}`;
    seenIds.add(id);
    headings.push({ level: Number(tag[1]), id, text: stripTags(inner) });
    return `<${tag} id="${id}">${inner}</${tag}>`;
  });

  // 2. fenced code -> .code-block
  html = html.replace(
    /<pre><code(?: class="language-([\w-]+)")?(?: data-title="([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_, lang, title, code) => {
      const label = escapeHtml(labelFor(lang, title));
      const inner = highlightComments(code, lang);
      return (
        `<div class="code-block">` +
        `<div class="code-block-head"><span>${label}</span>` +
        `<button class="copy-btn" type="button">Copy</button></div>` +
        `<pre><code>${inner}</code></pre></div>`
      );
    },
  );

  // 3. the code block right after an <h2> is a command signature
  html = html.replace(/(<\/h2>\s*)<div class="code-block">/g, '$1<div class="code-block cmd-sig">');

  // 4. blockquote -> .callout (GitHub alert type -> severity)
  html = html.replace(
    /<blockquote(?: data-alert="(\w+)")?>([\s\S]*?)<\/blockquote>/g,
    (_, alert, inner) => {
      const warn = /^(WARNING|CAUTION|DANGER)$/.test(alert || '');
      return `<div class="callout${warn ? ' callout-warn' : ''}">${inner}</div>`;
    },
  );

  // 5. table -> scrollable wrapper
  html = html.replace(/<table>[\s\S]*?<\/table>/g, (t) => `<div class="table-wrap">${t}</div>`);

  return html;
}

/* --------------------------------------------------------------- build -- */

export function buildDocsPage() {
  const manifest = JSON.parse(readFileSync(join(cfgDir, 'manifest.json'), 'utf8'));
  const aliases = manifest.slugAliases || {};
  const readmeUrl = manifest.readmeUrl || 'https://github.com/egelev/claude-modules';

  // first h2 slug of every source file, for bare `foo.md` links
  const firstIdByFile = {};
  for (const s of manifest.sections) {
    if (s.source.startsWith('@')) continue;
    const h = stripChrome(readFileSync(join(docsDir, s.source), 'utf8')).match(/^##\s+(.+)$/m);
    if (h) firstIdByFile[s.source] = aliases[slugify(h[1])] || slugify(h[1]);
  }
  const rewriteLink = makeRewriteLink(aliases, readmeUrl, firstIdByFile);

  const seenIds = new Set();
  const parts = [];
  const tocGroups = [];

  const partialHeadings = {
    '@intro': [
      { level: 2, id: 'installation', text: 'Installation' },
      { level: 2, id: 'configuration', text: 'Configuration' },
    ],
    '@appendix': [
      { level: 2, id: 'global-options', text: 'Global options' },
      { level: 2, id: 'known-limitations', text: 'Known limitations' },
    ],
  };

  for (const section of manifest.sections) {
    const headings = [];
    let html;

    if (section.source.startsWith('@')) {
      const file = section.source === '@intro' ? 'intro.html' : 'appendix.html';
      html = readFileSync(join(cfgDir, file), 'utf8').trim();
      for (const h of partialHeadings[section.source] || []) {
        seenIds.add(h.id);
        headings.push(h);
      }
    } else {
      const md = stripChrome(readFileSync(join(docsDir, section.source), 'utf8'));
      html = decorate(renderMarkdown(md, { rewriteLink }), { aliases, seenIds, headings });
    }

    parts.push(html);

    const entries = headings.filter((h) => h.level === 2 || (section.deep && h.level === 3));
    const last = tocGroups[tocGroups.length - 1];
    if (last && last.group === section.group) last.entries.push(...entries);
    else tocGroups.push({ group: section.group, entries });
  }

  const toc =
    `<nav class="docs-toc" aria-label="Documentation contents">\n` +
    tocGroups
      .map(
        (g) =>
          `        <h4>${escapeHtml(g.group)}</h4>\n        <ul>\n` +
          g.entries
            .map((e) => `          <li><a href="#${e.id}">${escapeHtml(e.text)}</a></li>`)
            .join('\n') +
          `\n        </ul>`,
      )
      .join('\n') +
    `\n      </nav>`;

  const content = `<article class="docs-content">\n${parts.join('\n\n')}\n      </article>`;

  // integrity: every in-page #anchor must resolve to an emitted id
  const ids = new Set([...content.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const dangling = [
    ...new Set(
      [...content.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).filter((a) => a && !ids.has(a)),
    ),
  ];
  if (dangling.length) {
    console.warn(`  docs: ${dangling.length} unresolved anchor(s) -> ${dangling.join(', ')}`);
  }

  return { toc, content };
}

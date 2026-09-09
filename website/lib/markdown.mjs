/*
 * Minimal CommonMark-subset renderer, scoped to what docs/*.md actually uses:
 * ATX headings, fenced code (with info string), GFM pipe tables, blockquotes
 * (incl. GitHub `> [!WARNING]` alerts), flat ordered / unordered lists,
 * paragraphs, thematic breaks (dropped), and inline code / bold / italic /
 * links / autolinks.
 *
 * Deliberately unsupported (not present in docs/): nested lists, indented code
 * blocks, setext headings, reference links, raw inline HTML, HTML blocks.
 */

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
export const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => HTML_ESCAPE[c]);
export const escapeAttr = (s) =>
  String(s).replace(/[&<>"]/g, (c) => (c === '"' ? '&quot;' : HTML_ESCAPE[c]));
export const stripTags = (s) => String(s).replace(/<[^>]+>/g, '');

/* ------------------------------------------------------------------ inline -- */

// Placeholder delimiters: private-use codepoints that never occur in Markdown
// source, so restoring them can't collide with real text such as " 3 plugins".
const PH_OPEN = '';
const PH_CLOSE = '';
const PH_RE = /(\d+)/g;

function applyEmphasis(s) {
  return s
    // bold first; lazy so it stops at the nearest closing `**`, and `[\s\S]`
    // rather than `[^*]` so a nested `*italic*` inside `**bold**` survives
    .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\\])\*([^*\s](?:[^*]*[^*\s])?)\*/g, '$1<em>$2</em>');
}

// Link label: emphasis + escaping only. Code spans in the label were already
// swapped for placeholders by inline() before the link regex ran, so they pass
// through untouched here and are restored by inline()'s final pass.
const inlineLabel = (text) => applyEmphasis(escapeHtml(text));

export function inline(text, { rewriteLink } = {}) {
  const rewrite = rewriteLink || ((h) => h);
  const slots = [];
  const hold = (html) => {
    slots.push(html);
    return `${PH_OPEN}${slots.length - 1}${PH_CLOSE}`;
  };

  let s = String(text);

  // code spans first, so nothing inside them is re-parsed
  s = s.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${escapeHtml(c)}</code>`));

  // [label](url) — same-tab, matching the rest of the site's link convention
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    hold(`<a href="${escapeAttr(rewrite(url.trim()))}">${inlineLabel(label)}</a>`),
  );

  // <https://autolink>
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, url) =>
    hold(`<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`),
  );

  s = escapeHtml(s);
  s = applyEmphasis(s);

  // Restore placeholders. Looped, because a held link label can itself contain
  // a held code-span placeholder that a single pass would leave behind.
  let prev;
  do {
    prev = s;
    s = s.replace(PH_RE, (_, i) => slots[+i] ?? '');
  } while (s !== prev);
  return s;
}

/* ------------------------------------------------------------------- blocks -- */

function renderCode(text, info) {
  const lang = (info.match(/^(\S+)/) || [, ''])[1];
  const title = (info.match(/title="([^"]*)"/) || [, ''])[1];
  const cls = lang ? ` class="language-${lang}"` : '';
  const attr = title ? ` data-title="${escapeAttr(title)}"` : '';
  return `<pre><code${cls}${attr}>${escapeHtml(text)}</code></pre>`;
}

function splitRow(row) {
  return row
    .replace(/^\s*\|?/, '')
    .replace(/\|?\s*$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

function renderTable(rows, opts) {
  const head = splitRow(rows[0]).map((c) => `<th>${inline(c, opts)}</th>`).join('');
  const body = rows
    .slice(2)
    .map((r) => `<tr>${splitRow(r).map((c) => `<td>${inline(c, opts)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderBlockquote(rawLines, opts) {
  const lines = rawLines.slice();
  let alert = null;
  const m = (lines[0] || '').match(/^\[!(\w+)\]\s*$/);
  if (m) {
    alert = m[1].toUpperCase();
    lines.shift();
    if (/^\s*$/.test(lines[0] || '')) lines.shift();
  }
  const inner = renderMarkdown(lines.join('\n'), opts);
  return `<blockquote${alert ? ` data-alert="${alert}"` : ''}>${inner}</blockquote>`;
}

const RE_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_FENCE = /^(```+|~~~+)\s*(.*)$/;
const RE_HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const RE_LI = /^\s*(?:[-*+]|\d+\.)\s+/;
const RE_QUOTE = /^\s*>/;

export function renderMarkdown(src, opts = {}) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    const fence = line.match(RE_FENCE);
    if (fence) {
      const close = new RegExp(`^${fence[1][0]}{3,}\\s*$`);
      const buf = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) buf.push(lines[i++]);
      i++; // consume closing fence
      out.push(renderCode(buf.join('\n'), fence[2].trim()));
      continue;
    }

    const heading = line.match(RE_HEADING);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2], opts)}</h${level}>`);
      i++;
      continue;
    }

    if (RE_HR.test(line)) {
      i++; // thematic breaks are chrome on the single-page site — drop them
      continue;
    }

    if (RE_QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(renderBlockquote(buf, opts));
      continue;
    }

    if (
      line.includes('|') &&
      lines[i + 1] &&
      lines[i + 1].includes('-') &&
      /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])
    ) {
      const buf = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) buf.push(lines[i++]);
      out.push(renderTable(buf, opts));
      continue;
    }

    if (RE_LI.test(line)) {
      const ordered = /^\s*\d+\.\s/.test(line);
      const items = [];
      while (i < lines.length) {
        const li = lines[i].match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
        if (li) {
          items.push([li[1]]);
          i++;
        } else if (items.length && /^\s+\S/.test(lines[i])) {
          items[items.length - 1].push(lines[i].trim()); // wrapped continuation line
          i++;
        } else {
          break;
        }
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(
        `<${tag}>${items.map((it) => `<li>${inline(it.join(' '), opts)}</li>`).join('')}</${tag}>`,
      );
      continue;
    }

    // paragraph — run until a blank line or the start of another block
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !RE_HEADING.test(lines[i]) &&
      !RE_FENCE.test(lines[i]) &&
      !RE_QUOTE.test(lines[i]) &&
      !RE_LI.test(lines[i]) &&
      !RE_HR.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(buf.join(' '), opts)}</p>`);
  }

  return out.join('\n');
}

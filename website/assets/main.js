// claude-modules site — shared behaviour. No frameworks, no build step.
// Progressive enhancement only: every page works with this file absent.

(() => {
  'use strict';

  const onReady = (fn) => {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  };

  function initMobileNav() {
    const toggle = document.querySelector('.nav-toggle');
    const links = document.querySelector('.nav-links');
    if (!toggle || !links) return;

    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    links.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => {
        links.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function initCopyButtons() {
    document.querySelectorAll('.code-block').forEach((block) => {
      const btn = block.querySelector('.copy-btn');
      const codeEl = block.querySelector('pre code') || block.querySelector('pre');
      if (!btn || !codeEl) return;

      const label = btn.textContent;
      const flashCopied = () => {
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = label;
          btn.classList.remove('copied');
        }, 1400);
      };

      btn.addEventListener('click', () => {
        const text = codeEl.innerText.replace(/\n+$/, '');
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(flashCopied, flashCopied);
          return;
        }
        // Fallback for non-secure contexts without the async Clipboard API.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } catch {
          /* clipboard unavailable; button still shows "Copy" */
        }
        document.body.removeChild(ta);
        flashCopied();
      });
    });
  }

  function initActiveNav() {
    // Resolve the current page name regardless of deploy path: a project-pages
    // deploy serves this at /<repo>/, where pathname has no filename at all.
    const last = location.pathname.split('/').pop();
    const page = last && last.endsWith('.html') ? last : 'index.html';
    document.querySelectorAll('.nav-links a[data-page]').forEach((a) => {
      if (a.dataset.page === page) a.classList.add('is-active');
    });
  }

  function initDocsToc() {
    const toc = document.querySelector('.docs-toc');
    const content = document.querySelector('.docs-content');
    if (!toc || !content) return;

    // Only h2s appear in the sidebar; observing h3s too would blank the whole
    // sidebar whenever an h3-only stretch of the page is in view.
    const headings = [...content.querySelectorAll('h2[id]')];
    const links = [...toc.querySelectorAll('a[href^="#"]')];
    if (!headings.length || !links.length) return;

    const linkByHref = {};
    links.forEach((l) => {
      linkByHref[l.getAttribute('href').slice(1)] = l;
    });

    let current = null;
    const setActive = (id) => {
      if (id === current) return;
      const active = linkByHref[id];
      if (!active) return; // no TOC entry for this heading — keep the current one lit
      current = id;
      links.forEach((l) => l.classList.remove('is-active'));
      active.classList.add('is-active');
      // scroll-behavior on .docs-toc (CSS) handles smoothness / reduced-motion.
      const top = active.offsetTop - toc.clientHeight / 2;
      toc.scrollTo({ top: Math.max(0, top) });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: 0 },
    );
    headings.forEach((h) => observer.observe(h));
  }

  function initBackToTop() {
    const btn = document.querySelector('.back-to-top');
    if (!btn) return;

    window.addEventListener(
      'scroll',
      () => {
        btn.classList.toggle('is-visible', window.scrollY > 600);
      },
      { passive: true },
    );
    // scroll-behavior on <html> (CSS) handles smoothness / reduced-motion.
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0 });
    });
  }

  onReady(() => {
    initMobileNav();
    initCopyButtons();
    initActiveNav();
    initDocsToc();
    initBackToTop();
  });
})();

/* ============================================================
   EXAM Bank — 문항 단위 DB 뷰어 (Vanilla JS · no build step)
   data/db.json (version 3) 을 읽어 문항 그리드 + 상세 모달을 렌더.
   ============================================================ */
'use strict';

(function () {
  // ---- DOM refs ----------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);

  const els = {
    brandTitle: $('#brand-title'),
    brandSub: $('#brand-sub'),
    search: $('#search'),
    searchClear: $('#search-clear'),
    groupFilters: $('#group-filters'),
    sortToggle: $('#sort-toggle'),
    sortLabel: $('#sort-label'),
    resultCount: $('#result-count'),
    grid: $('#grid'),
    skeleton: $('#skeleton'),
    empty: $('#empty'),
    loadError: $('#load-error'),
    noResults: $('#no-results'),
    footerLine: $('#footer-line'),
    // detail modal
    detail: $('#detail'),
    detailBackdrop: $('#detail-backdrop'),
    detailNum: $('#detail-num'),
    detailAnswer: $('#detail-answer'),
    detailSource: $('#detail-source'),
    detailSourceLabel: $('#detail-source-label'),
    detailClose: $('#detail-close'),
    detailImage: $('#detail-image'),
    detailTitle: $('#detail-title'),
    solutionPdfLink: $('#solution-pdf-link'),
    solutionContent: $('#solution-content'),
  };

  // ---- State -------------------------------------------------------------
  const state = {
    db: null,
    questions: [],
    groupOrder: [],          // db.groups order (canonical)
    activeGroup: 'all',      // 'all' | group name
    query: '',
    sortMode: 'group',       // 'group' | 'number'
    lastFocused: null,       // element to restore focus to after modal close
    mdCache: new Map(),      // url -> rendered HTML string
  };

  // ---- Utilities ---------------------------------------------------------
  function escapeHTML(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Strip Private-Use-Area glyphs (from PDF text extraction) so search/display
  // stay clean. Keeps normal text, digits, punctuation, Hangul, etc.
  function cleanText(s) {
    if (!s) return '';
    return String(s)
      .replace(/[-]/g, ' ')   // BMP private use area
      .replace(/\s+/g, ' ')
      .trim();
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // The single answer to show on a badge: prefer the choice glyph (answer),
  // fall back to answerText. Either may be empty.
  function answerBadgeText(q) {
    const a = (q.answer || '').trim();
    const t = (q.answerText || '').trim();
    if (a && t && a !== t) return `${a} (${t})`;
    return a || t || '';
  }

  // ---- Data load ---------------------------------------------------------
  async function load() {
    try {
      const res = await fetch('data/db.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const db = await res.json();
      state.db = db;
      state.questions = Array.isArray(db.questions) ? db.questions : [];
      state.groupOrder = Array.isArray(db.groups) ? db.groups.slice() : [];
      hydrateChrome(db);
      hideSkeleton();

      if (state.questions.length === 0) {
        els.empty.hidden = false;
        return;
      }
      buildGroupFilters();
      render();
    } catch (err) {
      console.error('[EXAM Bank] failed to load db.json:', err);
      hideSkeleton();
      els.loadError.hidden = false;
    }
  }

  function hideSkeleton() {
    els.skeleton.hidden = true;
    els.skeleton.style.display = 'none';
  }

  function hydrateChrome(db) {
    const title = db.title || 'EXAM Bank';
    document.title = `${title} — EXAM Bank`;
    els.brandTitle.textContent = title;
    const sub = [db.subject, db.count != null ? `총 ${db.count}문항` : null]
      .filter(Boolean).join(' · ');
    els.brandSub.textContent = sub || '문항 보관소';

    els.footerLine.textContent = [db.title, db.subject,
      db.count != null ? `${db.count}문항` : null].filter(Boolean).join(' · ');
  }

  // ---- Group filter chips ------------------------------------------------
  function buildGroupFilters() {
    const counts = {};
    for (const q of state.questions) {
      counts[q.group] = (counts[q.group] || 0) + 1;
    }
    // Canonical order from db.groups, then any extra groups found in data.
    const groups = state.groupOrder.slice();
    for (const g of Object.keys(counts)) {
      if (!groups.includes(g)) groups.push(g);
    }

    const frag = document.createDocumentFragment();
    frag.appendChild(makeChip('all', '전체', state.questions.length));
    for (const g of groups) {
      if (!counts[g]) continue;
      frag.appendChild(makeChip(g, g, counts[g]));
    }
    els.groupFilters.replaceChildren(frag);
    updateChipState();
  }

  function makeChip(value, label, count) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.group = value;
    btn.setAttribute('aria-pressed', String(value === state.activeGroup));
    btn.innerHTML =
      `<span class="chip-label">${escapeHTML(label)}</span>` +
      `<span class="chip-count">${count}</span>`;
    btn.addEventListener('click', () => {
      state.activeGroup = value;
      updateChipState();
      render();
    });
    return btn;
  }

  function updateChipState() {
    for (const chip of els.groupFilters.querySelectorAll('.chip')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.group === state.activeGroup));
    }
  }

  // ---- Filter + sort -----------------------------------------------------
  function groupRank(group) {
    const i = state.groupOrder.indexOf(group);
    return i === -1 ? 999 : i;
  }

  function getVisible() {
    const q = state.query.trim().toLowerCase();
    let list = state.questions.filter((item) => {
      if (state.activeGroup !== 'all' && item.group !== state.activeGroup) return false;
      if (!q) return true;
      const hay = [
        item.id,
        item.group,
        String(item.number),
        `${item.group} ${item.number}`,
        cleanText(item.text),
        item.answer,
        item.answerText,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });

    if (state.sortMode === 'number') {
      list = list.slice().sort((a, b) =>
        (a.number - b.number) || (groupRank(a.group) - groupRank(b.group)));
    } else {
      list = list.slice().sort((a, b) =>
        (groupRank(a.group) - groupRank(b.group)) || (a.number - b.number));
    }
    return list;
  }

  // ---- Render grid -------------------------------------------------------
  function render() {
    const list = getVisible();
    const total = state.questions.length;

    if (state.query.trim() || state.activeGroup !== 'all') {
      els.resultCount.textContent = `${list.length}개 표시 · 전체 ${total}문항`;
    } else {
      els.resultCount.textContent = `총 ${total}문항`;
    }

    els.empty.hidden = true;
    els.loadError.hidden = true;

    if (list.length === 0) {
      els.grid.replaceChildren();
      els.noResults.hidden = false;
      return;
    }
    els.noResults.hidden = true;

    const frag = document.createDocumentFragment();
    for (const q of list) frag.appendChild(makeCard(q));
    els.grid.replaceChildren(frag);
  }

  function makeCard(q) {
    const card = document.createElement('article');
    card.className = 'card';
    if (q.group) card.dataset.group = q.group;

    const ans = answerBadgeText(q);
    const numLabel = `${q.group} ${q.number}`;

    // Header: group-number badge + (optional) answer badge
    const head = document.createElement('div');
    head.className = 'card-head';
    head.innerHTML =
      `<span class="badge badge-num">${escapeHTML(numLabel)}</span>` +
      (ans ? `<span class="badge badge-answer">정답 ${escapeHTML(ans)}</span>` : '');
    card.appendChild(head);

    // Image thumbnail (lazy, clickable)
    const figBtn = document.createElement('button');
    figBtn.type = 'button';
    figBtn.className = 'card-thumb';
    figBtn.setAttribute('aria-label', `${numLabel} 문항 크게 보기`);
    if (q.image) {
      const img = document.createElement('img');
      img.src = q.image;            // root-relative path, used as-is
      img.alt = `${numLabel} 문항 이미지`;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => {
        figBtn.classList.add('thumb-error');
        figBtn.innerHTML = '<span class="thumb-fallback">이미지를 불러올 수 없습니다</span>';
      });
      figBtn.appendChild(img);
    } else {
      figBtn.classList.add('thumb-error');
      figBtn.innerHTML = '<span class="thumb-fallback">이미지 없음</span>';
    }
    figBtn.addEventListener('click', () => openDetail(q, figBtn));
    card.appendChild(figBtn);

    // Footer: "풀이 보기" button
    const foot = document.createElement('div');
    foot.className = 'card-foot';
    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'btn primary btn-block';
    view.innerHTML = '<span class="label">풀이 보기</span>';
    view.addEventListener('click', () => openDetail(q, view));
    foot.appendChild(view);
    card.appendChild(foot);

    return card;
  }

  // ---- Detail modal ------------------------------------------------------
  function sourcePdfHref(q) {
    const src = q.source || {};
    if (!src.pdf) return null;
    const page = src.page || 1;
    return `${src.pdf}#page=${page}`;
  }

  function openDetail(q, triggerEl) {
    state.lastFocused = triggerEl || document.activeElement;

    const numLabel = `${q.group} ${q.number}`;
    els.detailNum.textContent = numLabel;
    els.detailTitle.textContent = `${numLabel} 문항 상세`;

    const ans = answerBadgeText(q);
    if (ans) {
      els.detailAnswer.textContent = `정답 ${ans}`;
      els.detailAnswer.hidden = false;
    } else {
      els.detailAnswer.hidden = true;
    }

    // Source PDF link (original problem page)
    const href = sourcePdfHref(q);
    if (href) {
      els.detailSource.href = href;
      els.detailSourceLabel.textContent = `원본 문제 PDF p.${(q.source && q.source.page) || 1}`;
      els.detailSource.hidden = false;
    } else {
      els.detailSource.hidden = true;
    }

    // Question image (full size)
    if (q.image) {
      els.detailImage.src = q.image;
      els.detailImage.alt = `${numLabel} 문항 이미지`;
      els.detailImage.parentElement.hidden = false;
    } else {
      els.detailImage.removeAttribute('src');
      els.detailImage.parentElement.hidden = true;
    }

    // Solution region
    renderSolution(q);

    // Show modal
    els.detail.hidden = false;
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => els.detailClose.focus());
  }

  function setSolutionContent(html) {
    els.solutionContent.innerHTML = html;
  }

  function renderSolution(q) {
    const md = q.solutionMd || null;
    const pdf = q.solutionPdf || null;

    // Reset original-PDF link
    els.solutionPdfLink.hidden = true;
    els.solutionPdfLink.removeAttribute('href');

    if (md) {
      // generated markdown is primary; offer original PDF link too if present
      if (pdf) {
        els.solutionPdfLink.href = pdf;
        els.solutionPdfLink.hidden = false;
      }
      renderMarkdownSolution(md);
      return;
    }

    if (pdf) {
      // embed PDF + open/download actions
      setSolutionContent(
        '<div class="solution-pdf">' +
          `<iframe class="solution-frame" src="${escapeHTML(pdf)}#view=FitH" ` +
            'title="풀이 PDF 미리보기" loading="lazy"></iframe>' +
          '<div class="solution-pdf-actions">' +
            `<a class="btn ghost btn-sm" href="${escapeHTML(pdf)}" target="_blank" rel="noopener">` +
              '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-external"/></svg>' +
              '<span class="label">새 탭에서 열기</span></a>' +
            `<a class="btn ghost btn-sm" href="${escapeHTML(pdf)}" download>` +
              '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-download"/></svg>' +
              '<span class="label">다운로드</span></a>' +
          '</div>' +
        '</div>'
      );
      return;
    }

    // nothing available
    setSolutionContent('<p class="solution-empty">풀이 준비 중입니다.</p>');
  }

  async function renderMarkdownSolution(url) {
    setSolutionContent('<p class="solution-loading">풀이를 불러오는 중…</p>');

    if (state.mdCache.has(url)) {
      injectMarkdownHTML(state.mdCache.get(url));
      return;
    }

    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();

      // marked may still be loading (deferred CDN); wait briefly if needed.
      const ready = await waitFor(() => typeof window.marked !== 'undefined', 4000);
      if (!ready) {
        setSolutionContent('<p class="solution-empty">마크다운 렌더러를 불러오지 못했습니다. ' +
          `<a href="${escapeHTML(url)}" target="_blank" rel="noopener">원문 보기</a></p>`);
        return;
      }
      const parse = window.marked.parse || window.marked;
      const html = parse(text, { gfm: true, breaks: false });
      state.mdCache.set(url, html);
      injectMarkdownHTML(html);
    } catch (err) {
      console.error('[EXAM Bank] solution markdown load failed:', err);
      setSolutionContent('<p class="solution-empty">풀이 마크다운을 불러오지 못했습니다.</p>');
    }
  }

  function injectMarkdownHTML(html) {
    const wrap = document.createElement('div');
    wrap.className = 'markdown-body';
    wrap.innerHTML = html;   // marked output; source is our own generated MD
    els.solutionContent.replaceChildren(wrap);
    typesetMath(wrap);
  }

  function typesetMath(el) {
    const MJ = window.MathJax;
    if (MJ && typeof MJ.typesetPromise === 'function') {
      MJ.typesetPromise([el]).catch((e) =>
        console.warn('[EXAM Bank] MathJax typeset error:', e));
    } else if (MJ && MJ.startup && MJ.startup.promise) {
      MJ.startup.promise
        .then(() => MJ.typesetPromise([el]))
        .catch(() => {});
    }
    // If MathJax never loads, raw $...$ stays visible — acceptable fallback.
  }

  // Poll for a condition (used to await deferred CDN libs) without blocking.
  function waitFor(predicate, timeoutMs) {
    return new Promise((resolve) => {
      if (predicate()) return resolve(true);
      const start = Date.now();
      const id = setInterval(() => {
        if (predicate()) { clearInterval(id); resolve(true); }
        else if (Date.now() - start > timeoutMs) { clearInterval(id); resolve(false); }
      }, 60);
    });
  }

  function closeDetail() {
    if (els.detail.hidden) return;
    els.detail.hidden = true;
    document.body.classList.remove('modal-open');
    // stop PDF iframe / free image memory
    els.solutionContent.replaceChildren();
    els.detailImage.removeAttribute('src');
    // restore focus to the trigger
    const target = state.lastFocused;
    state.lastFocused = null;
    if (target && typeof target.focus === 'function' && document.contains(target)) {
      target.focus();
    }
  }

  // Focus trap inside the modal panel.
  function trapFocus(e) {
    if (els.detail.hidden || e.key !== 'Tab') return;
    const panel = els.detail.querySelector('.detail-panel');
    const focusables = panel.querySelectorAll(
      'a[href], button:not([disabled]), iframe, input, [tabindex]:not([tabindex="-1"])'
    );
    const visible = Array.from(focusables).filter((el) => !el.hidden && el.offsetParent !== null);
    if (visible.length === 0) return;
    const first = visible[0];
    const last = visible[visible.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  // ---- Sort toggle -------------------------------------------------------
  function toggleSort() {
    state.sortMode = state.sortMode === 'group' ? 'number' : 'group';
    const isNumber = state.sortMode === 'number';
    els.sortLabel.textContent = isNumber ? '번호순' : '그룹·번호순';
    els.sortToggle.setAttribute('aria-pressed', String(isNumber));
    render();
  }

  // ---- Events ------------------------------------------------------------
  function bindEvents() {
    const onSearch = debounce(() => {
      state.query = els.search.value;
      els.searchClear.hidden = !els.search.value;
      render();
    }, 140);
    els.search.addEventListener('input', onSearch);

    els.searchClear.addEventListener('click', () => {
      els.search.value = '';
      state.query = '';
      els.searchClear.hidden = true;
      render();
      els.search.focus();
    });

    els.sortToggle.addEventListener('click', toggleSort);

    els.detailClose.addEventListener('click', closeDetail);
    els.detailBackdrop.addEventListener('click', closeDetail);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!els.detail.hidden) { e.preventDefault(); closeDetail(); }
        else if (document.activeElement === els.search && els.search.value) {
          els.search.value = ''; state.query = '';
          els.searchClear.hidden = true; render();
        }
      }
      trapFocus(e);
    });
  }

  // ---- Init --------------------------------------------------------------
  function init() {
    bindEvents();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

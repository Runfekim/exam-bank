/* ============================================================
   EXAM Bank — 정적 뷰어 (Vanilla JS · no build step)
   2단 네비게이션:
     #/            → 시험지 목록 (data/exams.json)
     #/exam/<id>   → 문항 그리드 + 풀이 모달 (data/exams/<id>/db.json)
   경로는 모두 "저장소 루트 기준" — src/href 에 그대로 사용한다.
   ============================================================ */
'use strict';

(function () {
  // ---- DOM refs ----------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);

  const els = {
    // chrome
    searchWrap: $('#search-wrap'),
    search: $('#search'),
    searchClear: $('#search-clear'),
    footerLine: $('#footer-line'),
    main: $('#main'),

    // view: list
    viewList: $('#view-list'),
    listTitle: $('#list-title'),
    listSub: $('#list-sub'),
    examList: $('#exam-list'),
    listEmpty: $('#list-empty'),
    listError: $('#list-error'),

    // view: exam
    viewExam: $('#view-exam'),
    examEyebrow: $('#exam-eyebrow'),
    examTitle: $('#exam-title'),
    groupFilters: $('#group-filters'),
    sortToggle: $('#sort-toggle'),
    sortLabel: $('#sort-label'),
    resultCount: $('#result-count'),
    grid: $('#grid'),
    skeleton: $('#skeleton'),
    empty: $('#empty'),
    examError: $('#exam-error'),
    noResults: $('#no-results'),

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
    solutionContent: $('#solution-content'),
  };

  // ---- State -------------------------------------------------------------
  const state = {
    exams: null,             // exams.json -> array of exam metas
    examIndex: new Map(),    // id -> exam meta
    db: null,                // currently loaded exam db.json
    dbId: null,              // id of currently loaded db
    questions: [],
    groupOrder: [],
    activeGroup: 'all',
    query: '',
    sortMode: 'group',       // 'group' | 'number'
    lastFocused: null,
    mdCache: new Map(),
    dbCache: new Map(),      // id -> db.json (avoid refetch)
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

  // The answer to show on a badge: prefer the choice glyph (answer),
  // fall back to answerText. If both present and different → "① · 1".
  function answerBadgeText(q) {
    const a = (q.answer || '').trim();
    const t = (q.answerText || '').trim();
    if (a && t && a !== t) return `${a} · ${t}`;
    return a || t || '';
  }

  // Compact summary of a group list, e.g. "공통 · 확률과통계 외 2".
  function groupSummary(groups) {
    if (!Array.isArray(groups) || groups.length === 0) return '';
    if (groups.length <= 2) return groups.join(' · ');
    return `${groups.slice(0, 2).join(' · ')} 외 ${groups.length - 2}`;
  }

  function svgUse(id, cls) {
    return `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
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

  // ============================================================
  //  Routing  (#/  |  #/exam/<id>)
  // ============================================================
  function parseHash() {
    const raw = (location.hash || '').replace(/^#/, '');
    const parts = raw.split('/').filter(Boolean);  // e.g. ['exam','수능수학_2026']
    if (parts[0] === 'exam' && parts[1]) {
      return { name: 'exam', id: decodeURIComponent(parts.slice(1).join('/')) };
    }
    return { name: 'list' };
  }

  async function route() {
    closeDetail();
    const r = parseHash();

    // Ensure the exam index is available for both routes.
    if (!state.exams) {
      await loadExams();
    }

    if (r.name === 'exam') {
      // Unknown id → fall back to list.
      if (state.exams && !state.examIndex.has(r.id)) {
        location.replace('#/');
        return;
      }
      showExamView();
      await loadExam(r.id);
    } else {
      showListView();
    }
  }

  function showView(which) {
    const isList = which === 'list';
    els.viewList.hidden = !isList;
    els.viewExam.hidden = isList;
    els.searchWrap.hidden = isList;            // search only on exam view
    els.main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function showListView() {
    showView('list');
    document.title = 'EXAM Bank';
  }

  function showExamView() {
    showView('exam');
  }

  // ============================================================
  //  Stage 1 — Exam list (data/exams.json)
  // ============================================================
  async function loadExams() {
    try {
      const res = await fetch('data/exams.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const exams = Array.isArray(json.exams) ? json.exams : [];
      state.exams = exams;
      state.examIndex = new Map(exams.map((e) => [e.id, e]));
      renderExamList();
    } catch (err) {
      console.error('[EXAM Bank] failed to load exams.json:', err);
      state.exams = [];
      state.examIndex = new Map();
      els.listError.hidden = false;
    }
  }

  function renderExamList() {
    const exams = state.exams || [];
    const total = exams.length;
    els.listSub.textContent = total
      ? `${total}개의 시험지`
      : '';

    els.listEmpty.hidden = total > 0;
    if (total === 0) {
      els.examList.replaceChildren();
      return;
    }

    const frag = document.createDocumentFragment();
    for (const exam of exams) frag.appendChild(makeExamCard(exam));
    els.examList.replaceChildren(frag);
  }

  function makeExamCard(exam) {
    const a = document.createElement('a');
    a.className = 'exam-card';
    a.href = `#/exam/${encodeURIComponent(exam.id)}`;

    const meta = [
      exam.subject ? escapeHTML(exam.subject) : null,
      exam.count != null ? `${exam.count}문항` : null,
    ].filter(Boolean).join(' · ');

    const groups = groupSummary(exam.groups);

    a.innerHTML =
      '<div class="exam-card-body">' +
        `<p class="exam-card-eyebrow">${escapeHTML(exam.subject || '시험지')}</p>` +
        `<h2 class="exam-card-title">${escapeHTML(exam.title || exam.id)}</h2>` +
        (meta ? `<p class="exam-card-meta">${meta}</p>` : '') +
        (groups ? `<p class="exam-card-groups">${escapeHTML(groups)}</p>` : '') +
      '</div>' +
      `<span class="exam-card-arrow" aria-hidden="true">${svgUse('i-chevron-right', 'icon icon-sm')}</span>`;
    return a;
  }

  // ============================================================
  //  Stage 2 — Exam detail (data/exams/<id>/db.json)
  // ============================================================
  function resetExamView() {
    state.activeGroup = 'all';
    state.query = '';
    state.sortMode = 'group';
    els.search.value = '';
    els.searchClear.hidden = true;
    els.sortLabel.textContent = '그룹·번호순';
    els.sortToggle.setAttribute('aria-pressed', 'false');
    els.groupFilters.replaceChildren();
    els.grid.replaceChildren();
    els.resultCount.textContent = '';
    els.empty.hidden = true;
    els.examError.hidden = true;
    els.noResults.hidden = true;
  }

  function showSkeleton() {
    els.skeleton.hidden = false;
    els.skeleton.style.display = '';
  }
  function hideSkeleton() {
    els.skeleton.hidden = true;
    els.skeleton.style.display = 'none';
  }

  async function loadExam(id) {
    resetExamView();

    const meta = state.examIndex.get(id) || {};
    // Show meta title immediately for snappy UX.
    els.examTitle.textContent = meta.title || id;
    els.examEyebrow.textContent = meta.subject || '';
    document.title = `${meta.title || id} — EXAM Bank`;

    // Cached db → render instantly.
    if (state.dbCache.has(id)) {
      hideSkeleton();
      applyDb(id, state.dbCache.get(id));
      return;
    }

    showSkeleton();
    const dbPath = meta.db || `data/exams/${encodeURIComponent(id)}/db.json`;
    try {
      const res = await fetch(dbPath, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const db = await res.json();
      state.dbCache.set(id, db);
      hideSkeleton();
      // Ignore if the route changed while loading.
      if (parseHash().id !== id) return;
      applyDb(id, db);
    } catch (err) {
      console.error('[EXAM Bank] failed to load db.json:', err);
      hideSkeleton();
      els.examError.hidden = false;
    }
  }

  function applyDb(id, db) {
    state.db = db;
    state.dbId = id;
    state.questions = Array.isArray(db.questions) ? db.questions : [];
    state.groupOrder = Array.isArray(db.groups) ? db.groups.slice() : [];

    const title = db.title || (state.examIndex.get(id) || {}).title || id;
    els.examTitle.textContent = title;
    els.examEyebrow.textContent = [db.subject, db.count != null ? `${db.count}문항` : null]
      .filter(Boolean).join(' · ');
    document.title = `${title} — EXAM Bank`;

    if (state.questions.length === 0) {
      els.empty.hidden = false;
      return;
    }
    buildGroupFilters();
    renderGrid();
  }

  // ---- Group filter chips ------------------------------------------------
  function buildGroupFilters() {
    const counts = {};
    for (const q of state.questions) {
      counts[q.group] = (counts[q.group] || 0) + 1;
    }
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
      renderGrid();
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
  function renderGrid() {
    const list = getVisible();
    const total = state.questions.length;

    if (state.query.trim() || state.activeGroup !== 'all') {
      els.resultCount.textContent = `${list.length}개 표시 · 전체 ${total}문항`;
    } else {
      els.resultCount.textContent = `총 ${total}문항`;
    }

    els.empty.hidden = true;
    els.examError.hidden = true;

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

    const head = document.createElement('div');
    head.className = 'card-head';
    head.innerHTML =
      `<span class="badge badge-num">${escapeHTML(numLabel)}</span>` +
      (ans
        ? `<span class="badge badge-answer">${svgUse('i-check', 'icon icon-xs')}` +
          `<span>${escapeHTML(ans)}</span></span>`
        : '');
    card.appendChild(head);

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

    const foot = document.createElement('div');
    foot.className = 'card-foot';
    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'btn ghost btn-block';
    view.innerHTML = '<span class="label">풀이 보기</span>' + svgUse('i-chevron-right', 'icon icon-sm');
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
      els.detailAnswer.innerHTML = svgUse('i-check', 'icon icon-xs') +
        `<span>정답 ${escapeHTML(ans)}</span>`;
      els.detailAnswer.hidden = false;
    } else {
      els.detailAnswer.hidden = true;
    }

    const href = sourcePdfHref(q);
    if (href) {
      els.detailSource.href = href;
      els.detailSourceLabel.textContent = `원본 문제 PDF p.${(q.source && q.source.page) || 1}`;
      els.detailSource.hidden = false;
    } else {
      els.detailSource.hidden = true;
    }

    if (q.image) {
      els.detailImage.src = q.image;
      els.detailImage.alt = `${numLabel} 문항 이미지`;
      els.detailImage.parentElement.hidden = false;
    } else {
      els.detailImage.removeAttribute('src');
      els.detailImage.parentElement.hidden = true;
    }

    renderSolution(q);

    els.detail.hidden = false;
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => els.detailClose.focus());
  }

  function setSolutionContent(html) {
    els.solutionContent.innerHTML = html;
  }

  function renderSolution(q) {
    // 풀이는 마크다운(.md) 단일 포맷
    if (q.solutionMd) {
      renderMarkdownSolution(q.solutionMd);
      return;
    }
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
    structureSolution(wrap);
    els.solutionContent.replaceChildren(wrap);
    typesetMath(wrap);
  }

  // 렌더된 풀이에 시각 구조 클래스 부여: 섹션 구분선 · 볼드 단계 · 정답 콜아웃
  function structureSolution(root) {
    root.querySelectorAll('h2').forEach((h, i) => { if (i > 0) h.classList.add('md-divider'); });
    root.querySelectorAll('p').forEach((p) => {
      const t = p.textContent.trim();
      if (t.startsWith('정답') && t.length <= 32) { p.classList.add('md-answer'); return; }
      const f = p.firstElementChild;
      if (f && f.tagName === 'STRONG' && /^(\d+|[ㄱ-ㅎ])\s*[.)]/.test(t)) p.classList.add('md-step');
    });
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

  function closeDetail() {
    if (els.detail.hidden) return;
    els.detail.hidden = true;
    document.body.classList.remove('modal-open');
    els.solutionContent.replaceChildren();
    els.detailImage.removeAttribute('src');
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
    renderGrid();
  }

  // ---- Events ------------------------------------------------------------
  function bindEvents() {
    const onSearch = debounce(() => {
      state.query = els.search.value;
      els.searchClear.hidden = !els.search.value;
      renderGrid();
    }, 140);
    els.search.addEventListener('input', onSearch);

    els.searchClear.addEventListener('click', () => {
      els.search.value = '';
      state.query = '';
      els.searchClear.hidden = true;
      renderGrid();
      els.search.focus();
    });

    els.sortToggle.addEventListener('click', toggleSort);

    els.detailClose.addEventListener('click', closeDetail);
    els.detailBackdrop.addEventListener('click', closeDetail);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!els.detail.hidden) { e.preventDefault(); closeDetail(); return; }
        if (document.activeElement === els.search && els.search.value) {
          els.search.value = ''; state.query = '';
          els.searchClear.hidden = true; renderGrid();
        }
      }
      trapFocus(e);
    });

    window.addEventListener('hashchange', route);
  }

  // ---- Init --------------------------------------------------------------
  function init() {
    bindEvents();
    route();   // resolves current hash (list or deep-linked exam)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* ============================================================
   EXAM Bank — 정적 뷰어 (Vanilla JS · no build step)
   2단 네비게이션:
     #/            → 시험지 목록 (data/exams.json)
     #/exam/<id>   → 문항 그리드 + 풀이 모달 (data/exams/<id>/db.json)
   경로는 모두 "저장소 루트 기준" — src/href 에 그대로 사용한다.
   ============================================================ */
'use strict';

(function () {
  // localhost(또는 file://)에서만 로컬 전용 기능을 노출한다.
  // - 어드민 버튼: 공개 GitHub Pages 에는 숨김
  // - 원본 PDF 링크: PDF는 로컬에만 두므로(공개 저장소 미포함) 로컬에서만 표시
  const IS_LOCAL =
    location.protocol === 'file:' ||
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname);

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
    globalResults: $('#global-results'),
    globalCount: $('#global-count'),
    gresultList: $('#gresult-list'),
    globalEmpty: $('#global-empty'),

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
    detailFigure: $('#detail-figure'),
    detailTitle: $('#detail-title'),
    qviewSeg: $('#qview-seg'),
    detailQbody: $('#detail-qbody'),
    detailQbodyContent: $('#detail-qbody-content'),
    solutionContent: $('#solution-content'),

    // header
    themeToggle: $('#theme-toggle'),
    adminLink: $('#admin-link'),
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
    currentQ: null,          // 상세 모달에 열린 문항(보기 전환용)
    searchIndex: null,       // data/search-index.json (전체 검색)
    searchIndexLoading: null,
    pendingOpenQid: null,    // 딥링크/검색결과로 진입 시 열 문항 id
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

  // 마크다운/수식/HTML 제거 → 평문(검색용, 자르지 않음).
  function bodyText(s) {
    if (!s) return '';
    return String(s)
      .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')               // HTML 태그(<u> 등)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')              // 이미지
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')             // 링크 → 텍스트
      .replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\$[^$\n]*\$/g, ' ')  // 수식
      .replace(/\\[a-zA-Z]+/g, ' ')                        // LaTeX 명령
      .replace(/[#>*_`~|\\{}$^]/g, ' ')
      .replace(/[-]/g, ' ')                   // PUA
      .replace(/\s+/g, ' ').trim();
  }

  // 카드 썸네일용 본문 미리보기: 마크다운 기호 제거 후 앞부분만.
  function previewText(s) {
    if (!s) return '';
    return String(s)
      .replace(/[#>*_`~]/g, '')
      .replace(/\$[^$]*\$/g, ' ')      // 인라인 수식 제거
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
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
    const parts = raw.split('/').filter(Boolean);  // e.g. ['exam','수능수학_2026'] | ['exam',id,'q',qid]
    if (parts[0] === 'exam' && parts[1]) {
      // 딥링크: #/exam/<id>/q/<qid> — 특정 문항 모달 열기
      const qi = parts.indexOf('q');
      if (qi >= 2 && parts[qi + 1]) {
        return {
          name: 'exam',
          id: decodeURIComponent(parts.slice(1, qi).join('/')),
          qid: decodeURIComponent(parts.slice(qi + 1).join('/')),
        };
      }
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
      state.pendingOpenQid = r.qid || null;   // 딥링크로 열 문항(있으면)
      showExamView();
      await loadExam(r.id);
    } else {
      showListView();
      // 홈 진입 시 현재 검색어가 있으면 전체 검색 결과 갱신
      runListSearch();
    }
  }

  function showView(which) {
    const isList = which === 'list';
    document.body.dataset.route = which;       // 홈(list)에선 푸터 숨김 (CSS)
    els.viewList.hidden = !isList;
    els.viewExam.hidden = isList;
    els.searchWrap.hidden = false;             // 검색은 두 뷰 모두 노출(홈=전체검색)
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
  //  전체(교차) 검색 — data/search-index.json (정적, 서버 불필요)
  //  GitHub Pages엔 서버 DB가 없으므로 정적 인덱스 + 순수 JS 검색이 대안.
  // ============================================================
  function loadSearchIndex() {
    if (state.searchIndex) return Promise.resolve(state.searchIndex);
    if (state.searchIndexLoading) return state.searchIndexLoading;
    state.searchIndexLoading = (async () => {
      try {
        const res = await fetch('data/search-index.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        state.searchIndex = json && Array.isArray(json.questions) ? json : { questions: [] };
      } catch (err) {
        console.error('[EXAM Bank] search-index.json load failed:', err);
        state.searchIndex = { questions: [] };
      }
      return state.searchIndex;
    })();
    return state.searchIndexLoading;
  }

  // 다중어 AND 부분매치 + 앞쪽/번호 가산 스코어링(의존성 없음).
  function searchQuestions(query) {
    const idx = state.searchIndex;
    if (!idx) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const scored = [];
    for (const q of idx.questions) {
      const hay = q.s || '';
      let ok = true, score = 0;
      for (const t of terms) {
        const i = hay.indexOf(t);
        if (i < 0) { ok = false; break; }
        score += 2 - Math.min(1, i / 240);             // 앞쪽 매치 가산
        if (`${q.group} ${q.number}` === t || String(q.number) === t) score += 2;
      }
      if (ok) scored.push({ q, score });
    }
    scored.sort((a, b) =>
      b.score - a.score ||
      a.q.examTitle.localeCompare(b.q.examTitle, 'ko') ||
      (a.q.number - b.q.number));
    return scored.slice(0, 80).map((x) => x.q);
  }

  async function runListSearch() {
    if (parseHash().name !== 'list') return;
    const query = (els.search.value || '').trim();
    if (!query) {
      els.globalResults.hidden = true;
      els.globalEmpty.hidden = true;
      els.examList.hidden = false;
      return;
    }
    await loadSearchIndex();
    // 비동기 로드 사이 라우트/검색어가 바뀌었으면 무시
    if (parseHash().name !== 'list' || (els.search.value || '').trim() !== query) return;
    const results = searchQuestions(query);
    els.examList.hidden = true;
    if (!results.length) {
      els.globalResults.hidden = true;
      els.globalEmpty.hidden = false;
      return;
    }
    els.globalEmpty.hidden = true;
    els.globalResults.hidden = false;
    els.globalCount.textContent = `${results.length}개 문항 · ${results.length >= 80 ? '상위 80개' : '전체'}`;
    const frag = document.createDocumentFragment();
    for (const q of results) frag.appendChild(makeGlobalResult(q));
    els.gresultList.replaceChildren(frag);
  }

  function makeGlobalResult(q) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gresult';
    const ans = (q.answer || '').trim();
    btn.innerHTML =
      '<div class="gresult-top">' +
        `<span class="gresult-exam">${escapeHTML(q.examTitle)}</span>` +
        `<span class="gresult-loc">${escapeHTML(q.group)} ${q.number}</span>` +
        (ans
          ? `<span class="badge badge-answer">${svgUse('i-check', 'icon icon-xs')}<span>${escapeHTML(ans)}</span></span>`
          : '') +
      '</div>' +
      `<p class="gresult-snip">${escapeHTML(q.snippet || '')}</p>`;
    btn.addEventListener('click', () => {
      location.hash = `#/exam/${encodeURIComponent(q.examId)}/q/${encodeURIComponent(q.id)}`;
    });
    return btn;
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

    // 딥링크/전체검색 결과로 진입한 경우 해당 문항 모달 열기
    if (state.pendingOpenQid) {
      const q = state.questions.find((x) => x.id === state.pendingOpenQid);
      state.pendingOpenQid = null;
      if (q) openDetail(q, null);
    }
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
        item.body ? bodyText(item.body) : '',   // 전사 본문까지 검색
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
    } else if (q.body || q.text) {
      // 텍스트 전사형 문항: 본문 미리보기(스니펫)
      figBtn.classList.add('thumb-text');
      const p = document.createElement('p');
      p.className = 'thumb-text-preview';
      p.textContent = previewText(q.body || q.text);
      figBtn.appendChild(p);
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

    // PDF는 로컬에만 보관(공개 저장소 미포함) → 로컬에서만 원본 링크 노출
    const href = sourcePdfHref(q);
    if (href && IS_LOCAL) {
      els.detailSource.href = href;
      els.detailSourceLabel.textContent = `원본 문제 PDF p.${(q.source && q.source.page) || 1}`;
      els.detailSource.hidden = false;
    } else {
      els.detailSource.hidden = true;
    }

    // 이미지/본문 준비 + 보기 전환(원본 이미지 ↔ 텍스트 모던카드)
    if (q.image) {
      els.detailImage.src = q.image;
      els.detailImage.alt = `${numLabel} 문항 이미지`;
    } else {
      els.detailImage.removeAttribute('src');
    }
    delete els.detailQbody.dataset.rendered;   // 본문 렌더 캐시 초기화(문항별)
    els.detailQbodyContent.replaceChildren();
    state.currentQ = q;
    setupQView(q);

    renderSolution(q);

    els.detail.hidden = false;
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => els.detailClose.focus());
  }

  // ---- 문항 보기 전환 (원본 이미지 ↔ 텍스트 모던카드) -------------------
  const QVIEW_KEY = 'exambank.qview';
  function preferredQView() {
    try {
      const v = localStorage.getItem(QVIEW_KEY);
      if (v === 'image' || v === 'text') return v;
    } catch (e) { /* ignore */ }
    return 'text';   // 기본: 텍스트(가독성·완전성). 둘 다 있을 때만 의미.
  }

  function setupQView(q) {
    const hasImage = !!q.image;
    const hasBody = !!q.body;
    const both = hasImage && hasBody;
    els.qviewSeg.hidden = !both;
    // 둘 다 있으면 저장된 선호, 아니면 가진 쪽으로.
    const mode = both ? preferredQView() : (hasBody ? 'text' : 'image');
    applyQView(q, mode);
  }

  function applyQView(q, mode) {
    const showText = mode === 'text';
    // 원본 이미지
    els.detailFigure.hidden = !q.image || showText;
    // 텍스트 본문(모던카드) — 최초 표시 때 1회 렌더
    if (q.body) {
      els.detailQbody.hidden = !showText;
      if (showText && !els.detailQbody.dataset.rendered) {
        renderInlineMarkdown(els.detailQbodyContent, q.body);
        els.detailQbody.dataset.rendered = '1';
      }
    } else {
      els.detailQbody.hidden = true;
    }
    // 세그 상태
    for (const b of els.qviewSeg.querySelectorAll('.qview-opt')) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    }
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

  // 문자열 마크다운(문항 본문 등)을 임의 컨테이너에 렌더 + 수식 조판.
  async function renderInlineMarkdown(target, mdText) {
    target.innerHTML = '<p class="solution-loading">불러오는 중…</p>';
    const ready = await waitFor(() => typeof window.marked !== 'undefined', 4000);
    if (!ready) { target.textContent = mdText; return; }
    const parse = window.marked.parse || window.marked;
    const wrap = document.createElement('div');
    wrap.className = 'markdown-body';
    wrap.innerHTML = parse(mdText, { gfm: true, breaks: true });
    target.replaceChildren(wrap);
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
    els.detailQbodyContent.replaceChildren();
    els.detailQbody.hidden = true;
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
      els.searchClear.hidden = !els.search.value;
      if (parseHash().name === 'exam') {
        state.query = els.search.value;
        renderGrid();
      } else {
        runListSearch();           // 홈 = 전체(교차) 검색
      }
    }, 140);
    els.search.addEventListener('input', onSearch);

    els.searchClear.addEventListener('click', () => {
      els.search.value = '';
      els.searchClear.hidden = true;
      if (parseHash().name === 'exam') { state.query = ''; renderGrid(); }
      else runListSearch();
      els.search.focus();
    });

    els.sortToggle.addEventListener('click', toggleSort);
    els.themeToggle.addEventListener('click', toggleTheme);

    els.detailClose.addEventListener('click', closeDetail);
    els.detailBackdrop.addEventListener('click', closeDetail);

    // 문항 보기 전환(원본 이미지 ↔ 텍스트) — 선택 기억
    els.qviewSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('.qview-opt');
      if (!btn || !state.currentQ) return;
      const mode = btn.dataset.mode;
      try { localStorage.setItem(QVIEW_KEY, mode); } catch (err) { /* ignore */ }
      applyQView(state.currentQ, mode);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!els.detail.hidden) { e.preventDefault(); closeDetail(); return; }
        if (document.activeElement === els.search && els.search.value) {
          els.search.value = '';
          els.searchClear.hidden = true;
          if (parseHash().name === 'exam') { state.query = ''; renderGrid(); }
          else runListSearch();
        }
      }
      trapFocus(e);
    });

    window.addEventListener('hashchange', route);
  }

  // 헤더 테마 토글 (라이트 ↔ 다크). data-theme 는 <head> 인라인 스크립트가 미리 설정.
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('exambank.theme', next); } catch (e) {}
    document.documentElement.dataset.theme = next;
  }

  // ---- Init --------------------------------------------------------------
  function init() {
    if (els.adminLink && IS_LOCAL) els.adminLink.hidden = false;  // 로컬에서만 관리자 진입 노출
    bindEvents();
    route();   // resolves current hash (list or deep-linked exam)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

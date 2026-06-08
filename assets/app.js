"use strict";

/* ============================================================
   EXAM Bank — 정적 카탈로그 뷰어 (catalog.json v2 "세트" 모델)
   흐름: 라이브러리(세트 카드) → 세트 상세(문제지 + 그룹별 풀이) → PDF 모달.
   catalog.json 은 GitHub Action(scripts/build-catalog.mjs)이 자동 생성한다.
   스키마: { version, count, sets:[{ id, title, subject, tags,
            problems:[{label,pdf,size}],
            solutionGroups:[{group, items:[{label,pdf,size}]}],
            problemCount, solutionCount }] }
   pdf 경로는 저장소 루트 기준 상대경로 → 사이트(루트 서빙)에서 그대로 사용.
   ============================================================ */

const SUBJECTS_KNOWN = ["수학", "국어", "영어", "과학", "사회", "한국사", "기타"];

const state = {
  sets: [],
  subject: "전체",
  query: "",
};

const el = {
  grid: document.getElementById("grid"),
  skeleton: document.getElementById("skeleton"),
  empty: document.getElementById("empty"),
  noResults: document.getElementById("no-results"),
  filters: document.getElementById("subject-filters"),
  search: document.getElementById("search"),
  count: document.getElementById("result-count"),
  totalLine: document.getElementById("total-line"),
  repoLink: document.getElementById("repo-link"),
  // detail
  detail: document.getElementById("detail"),
  detailBody: document.getElementById("detail-body"),
  // viewer
  viewer: document.getElementById("viewer"),
  viewerFrame: document.getElementById("viewer-frame"),
  viewerTitle: document.getElementById("viewer-title"),
  viewerOpen: document.getElementById("viewer-open"),
  viewerDownload: document.getElementById("viewer-download"),
  viewerClose: document.getElementById("viewer-close"),
};

// 모달/오버레이가 닫힐 때 포커스를 되돌릴 트리거 요소
let detailTrigger = null;
let viewerTrigger = null;

init();

async function init() {
  setRepoLink();
  bindGlobalEvents();
  try {
    const res = await fetch("data/catalog.json", { cache: "no-cache" });
    const data = await res.json();
    state.sets = Array.isArray(data.sets) ? data.sets : [];
  } catch (e) {
    state.sets = [];
  }
  if (el.skeleton) el.skeleton.hidden = true;
  renderFilters();
  render();
}

/* ---- icon helper ---------------------------------------------------- */
function icon(id, cls) {
  return `<svg class="icon ${cls || ""}" aria-hidden="true"><use href="#${id}"/></svg>`;
}

function bindGlobalEvents() {
  el.search.addEventListener("input", (e) => {
    state.query = e.target.value.trim().toLowerCase();
    render();
  });

  // PDF viewer
  el.viewerClose.addEventListener("click", closeViewer);
  el.viewer.addEventListener("click", (e) => {
    if (e.target === el.viewer) closeViewer();
  });

  // ESC: 뷰어가 위, 그 다음 상세
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!el.viewer.hidden) closeViewer();
    else if (!el.detail.hidden) closeDetail();
  });
}

/* ============================================================
   Subject filters
   ============================================================ */
function subjects() {
  const set = new Set(state.sets.map((s) => s.subject || "기타"));
  return ["전체", ...[...set].sort((a, b) => a.localeCompare(b, "ko"))];
}

function renderFilters() {
  el.filters.innerHTML = "";
  for (const s of subjects()) {
    const b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.textContent = s;
    b.setAttribute("aria-pressed", s === state.subject ? "true" : "false");
    b.addEventListener("click", () => {
      state.subject = s;
      renderFilters();
      render();
    });
    el.filters.appendChild(b);
  }
}

/* ============================================================
   Library list
   ============================================================ */
function filtered() {
  return state.sets.filter((s) => {
    if (state.subject !== "전체" && (s.subject || "기타") !== state.subject) return false;
    if (!state.query) return true;
    const hay = [s.title, s.subject, ...(s.tags || [])].join(" ").toLowerCase();
    return hay.includes(state.query);
  });
}

function render() {
  const list = filtered();
  el.grid.innerHTML = "";

  const noData = state.sets.length === 0;
  el.empty.hidden = !noData;
  el.noResults.hidden = noData || list.length > 0;

  for (const s of list) el.grid.appendChild(card(s));

  el.count.textContent = noData ? "" : `${list.length}개 세트`;
  el.totalLine.textContent = noData ? "" : `총 ${state.sets.length}개 세트`;
}

function subjectAttr(subject) {
  return SUBJECTS_KNOWN.includes(subject) ? subject : "";
}

function card(s) {
  const subject = s.subject || "기타";
  const c = document.createElement("button");
  c.className = "card";
  c.type = "button";
  c.setAttribute("data-subject", subjectAttr(subject));
  c.setAttribute("aria-label", `${s.title} 세트 열기`);

  const pCount = s.problemCount != null ? s.problemCount : (s.problems || []).length;
  const sCount = s.solutionCount != null
    ? s.solutionCount
    : (s.solutionGroups || []).reduce((n, g) => n + (g.items || []).length, 0);

  const tags = (s.tags || [])
    .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
    .join("");

  c.innerHTML = `
    <span class="card-subject">${escapeHtml(subject)}</span>
    <span class="card-title">${escapeHtml(s.title || s.id)}</span>
    <span class="card-stats">
      <span>문제 ${pCount}</span><span class="dot">·</span><span>풀이 ${sCount}</span>
    </span>
    ${tags ? `<span class="tags">${tags}</span>` : ""}
  `;

  c.addEventListener("click", () => openDetail(s, c));
  return c;
}

/* ============================================================
   Set detail overlay
   ============================================================ */
function openDetail(set, trigger) {
  detailTrigger = trigger || null;
  el.detail.setAttribute("data-subject", subjectAttr(set.subject || "기타"));
  el.detailBody.innerHTML = renderDetail(set);
  wireDetail(set);
  el.detail.hidden = false;
  document.body.style.overflow = "hidden";
  const back = el.detailBody.querySelector(".detail-back");
  if (back) back.focus();
}

function closeDetail() {
  el.detail.hidden = true;
  el.detailBody.innerHTML = "";
  if (el.viewer.hidden) document.body.style.overflow = "";
  if (detailTrigger && document.contains(detailTrigger)) detailTrigger.focus();
  detailTrigger = null;
}

function renderDetail(set) {
  const subject = set.subject || "기타";
  const pCount = set.problemCount != null ? set.problemCount : (set.problems || []).length;
  const groups = set.solutionGroups || [];
  const sCount = set.solutionCount != null
    ? set.solutionCount
    : groups.reduce((n, g) => n + (g.items || []).length, 0);

  const tags = (set.tags || [])
    .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
    .join("");

  /* ---- 문제지 섹션 ---- */
  const problems = set.problems || [];
  const problemsHtml = problems.length
    ? `<div class="problem-list">${problems
        .map((p, i) => `
          <button class="btn problem btn-lg" type="button" data-problem="${i}">
            ${icon("i-file", "icon-sm")}
            <span class="label">${escapeHtml(p.label || "문제지")}</span>
            <span class="size">${formatSize(p.size)}</span>
          </button>`)
        .join("")}</div>`
    : `<p class="group-empty">등록된 문제지가 없습니다.</p>`;

  /* ---- 풀이 섹션: 탭(데스크탑) + 아코디언(모바일) ---- */
  let solutionHtml;
  if (!groups.length) {
    solutionHtml = `<p class="group-empty">등록된 풀이가 없습니다.</p>`;
  } else {
    const tabs = groups
      .map((g, gi) => `
        <button class="group-tab" type="button" role="tab" id="gt-${gi}"
                aria-controls="gp-${gi}" aria-selected="${gi === 0 ? "true" : "false"}"
                tabindex="${gi === 0 ? "0" : "-1"}">
          ${escapeHtml(g.group)}<span class="group-count-inline">${(g.items || []).length}</span>
        </button>`)
      .join("");

    const panels = groups
      .map((g, gi) => `
        <div class="group-panel" id="gp-${gi}" role="tabpanel" aria-labelledby="gt-${gi}" ${gi === 0 ? "" : "hidden"}>
          ${solutionGrid(g, gi)}
        </div>`)
      .join("");

    const acc = groups
      .map((g, gi) => `
        <details class="group-acc" ${gi === 0 ? "open" : ""}>
          <summary class="group-head">
            <span>${escapeHtml(g.group)}</span>
            <span class="group-count">${(g.items || []).length}</span>
            ${icon("i-chevron-down", "icon-sm chevron")}
          </summary>
          ${solutionGrid(g, gi)}
        </details>`)
      .join("");

    solutionHtml = `
      <div class="group-tabs" role="tablist" aria-label="풀이 그룹">${tabs}</div>
      ${panels}
      <div class="group-accordion">${acc}</div>`;
  }

  return `
    <button class="detail-back" type="button">${icon("i-arrow-left", "icon-sm")} 목록</button>
    <div class="detail-grid">
      <aside class="set-aside set-detail">
        <h1 id="detail-title">${escapeHtml(set.title || set.id)}</h1>
        <span class="card-subject aside-badge">${escapeHtml(subject)}</span>
        ${tags ? `<div class="tags">${tags}</div>` : ""}
        <p class="aside-summary">문제 ${pCount} · 풀이 ${sCount}</p>
      </aside>
      <div class="set-main set-detail">
        <section>
          <h2 class="section-heading">문제지</h2>
          ${problemsHtml}
        </section>
        <section>
          <h2 class="section-heading">풀이</h2>
          ${solutionHtml}
        </section>
      </div>
    </div>`;
}

function solutionGrid(group, gi) {
  const items = group.items || [];
  if (!items.length) return `<p class="group-empty">풀이 없음</p>`;
  const tiles = items
    .map((it, ii) => `
      <button class="sol-tile" type="button" data-group="${gi}" data-item="${ii}"
              aria-label="${escapeHtml(group.group)} ${escapeHtml(it.label)} 풀이 열기">
        ${escapeHtml(it.label)}
      </button>`)
    .join("");
  return `<div class="solution-grid">${tiles}</div>`;
}

function wireDetail(set) {
  const root = el.detailBody;

  root.querySelector(".detail-back").addEventListener("click", closeDetail);

  // 문제지 버튼
  root.querySelectorAll("[data-problem]").forEach((btn) => {
    const p = (set.problems || [])[Number(btn.dataset.problem)];
    if (!p) return;
    btn.addEventListener("click", () => openViewer(p.label || "문제지", p.pdf, btn));
  });

  // 풀이 타일
  root.querySelectorAll(".sol-tile").forEach((tile) => {
    const g = (set.solutionGroups || [])[Number(tile.dataset.group)];
    const it = g && (g.items || [])[Number(tile.dataset.item)];
    if (!it) return;
    const title = `${g.group} ${it.label}`;
    tile.addEventListener("click", () => openViewer(title, it.pdf, tile));
  });

  // 그룹 탭(데스크탑) — 클릭 + 화살표키
  const tabs = [...root.querySelectorAll(".group-tab")];
  const panels = [...root.querySelectorAll(".group-panel")];
  function selectTab(idx) {
    tabs.forEach((t, i) => {
      const on = i === idx;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    panels.forEach((p, i) => { p.hidden = i !== idx; });
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => selectTab(i));
    tab.addEventListener("keydown", (e) => {
      let ni = null;
      if (e.key === "ArrowRight") ni = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") ni = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") ni = 0;
      else if (e.key === "End") ni = tabs.length - 1;
      if (ni === null) return;
      e.preventDefault();
      selectTab(ni);
      tabs[ni].focus();
    });
  });
}

/* ============================================================
   PDF viewer modal
   ============================================================ */
function openViewer(title, path, trigger) {
  viewerTrigger = trigger || null;
  el.viewerTitle.textContent = title || "";
  el.viewerOpen.href = path;
  el.viewerDownload.href = path;
  el.viewerFrame.src = path;
  el.viewer.hidden = false;
  document.body.style.overflow = "hidden";
  el.viewerClose.focus();
}

function closeViewer() {
  el.viewer.hidden = true;
  el.viewerFrame.src = "about:blank";
  // 상세가 아직 열려있으면 스크롤 잠금 유지
  if (el.detail.hidden) document.body.style.overflow = "";
  if (viewerTrigger && document.contains(viewerTrigger)) viewerTrigger.focus();
  viewerTrigger = null;
}

/* ============================================================
   Utils
   ============================================================ */
function formatSize(bytes) {
  if (bytes == null || isNaN(bytes)) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// user.github.io/<repo> 형태에서 저장소 링크를 추정합니다.
function setRepoLink() {
  const host = location.hostname; // user.github.io
  const m = host.match(/^([^.]+)\.github\.io$/);
  if (m) {
    const user = m[1];
    const seg = location.pathname.split("/").filter(Boolean);
    const repo = seg.length ? seg[0] : `${user}.github.io`;
    el.repoLink.href = `https://github.com/${user}/${repo}`;
  } else {
    el.repoLink.href = "https://github.com";
  }
}

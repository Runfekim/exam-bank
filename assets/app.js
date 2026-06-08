"use strict";

// EXAM Bank — 정적 카탈로그 뷰어
// data/catalog.json 을 읽어 카드 목록을 그립니다. (catalog.json 은 GitHub Action 이 자동 생성)

const state = {
  items: [],
  subject: "전체",
  query: "",
};

const el = {
  grid: document.getElementById("grid"),
  empty: document.getElementById("empty"),
  filters: document.getElementById("subject-filters"),
  search: document.getElementById("search"),
  count: document.getElementById("result-count"),
  totalLine: document.getElementById("total-line"),
  repoLink: document.getElementById("repo-link"),
  viewer: document.getElementById("viewer"),
  viewerFrame: document.getElementById("viewer-frame"),
  viewerTitle: document.getElementById("viewer-title"),
  viewerOpen: document.getElementById("viewer-open"),
  viewerDownload: document.getElementById("viewer-download"),
  viewerClose: document.getElementById("viewer-close"),
};

init();

async function init() {
  setRepoLink();
  bindEvents();
  try {
    const res = await fetch("data/catalog.json", { cache: "no-cache" });
    const data = await res.json();
    state.items = Array.isArray(data.items) ? data.items : [];
  } catch (e) {
    state.items = [];
  }
  renderFilters();
  render();
}

function bindEvents() {
  el.search.addEventListener("input", (e) => {
    state.query = e.target.value.trim().toLowerCase();
    render();
  });
  el.viewerClose.addEventListener("click", closeViewer);
  el.viewer.addEventListener("click", (e) => {
    if (e.target === el.viewer) closeViewer();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.viewer.hidden) closeViewer();
  });
}

function subjects() {
  const set = new Set(state.items.map((it) => it.subject || "기타"));
  return ["전체", ...[...set].sort((a, b) => a.localeCompare(b, "ko"))];
}

function renderFilters() {
  el.filters.innerHTML = "";
  for (const s of subjects()) {
    const b = document.createElement("button");
    b.className = "chip" + (s === state.subject ? " active" : "");
    b.textContent = s;
    b.addEventListener("click", () => {
      state.subject = s;
      renderFilters();
      render();
    });
    el.filters.appendChild(b);
  }
}

function filtered() {
  return state.items.filter((it) => {
    if (state.subject !== "전체" && (it.subject || "기타") !== state.subject) return false;
    if (!state.query) return true;
    const hay = [it.title, it.subject, ...(it.tags || [])].join(" ").toLowerCase();
    return hay.includes(state.query);
  });
}

function render() {
  const list = filtered();
  el.grid.innerHTML = "";

  const noData = state.items.length === 0;
  el.empty.hidden = !noData;

  for (const it of list) el.grid.appendChild(card(it));

  el.count.textContent = noData ? "" : `${list.length}개 자료`;
  el.totalLine.textContent = noData ? "" : `총 ${state.items.length}개 자료`;
}

function card(it) {
  const c = document.createElement("article");
  c.className = "card";

  const subject = document.createElement("span");
  subject.className = "card-subject";
  subject.textContent = it.subject || "기타";

  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = it.title || it.id;

  c.append(subject, title);

  if (it.size) {
    const meta = document.createElement("p");
    meta.className = "card-meta";
    meta.textContent = formatSize(it.size);
    c.appendChild(meta);
  }

  if (it.tags && it.tags.length) {
    const tags = document.createElement("div");
    tags.className = "tags";
    for (const t of it.tags) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "#" + t;
      tags.appendChild(tag);
    }
    c.appendChild(tags);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const problemBtn = document.createElement("button");
  problemBtn.className = "btn problem";
  problemBtn.textContent = "문제 보기";
  problemBtn.addEventListener("click", () => openViewer(it.title, it.problemPdf));
  actions.appendChild(problemBtn);

  const solBtn = document.createElement("button");
  if (it.solutionPdf) {
    solBtn.className = "btn solution";
    solBtn.textContent = "풀이 보기";
    solBtn.addEventListener("click", () => openViewer((it.title || "") + " (풀이)", it.solutionPdf));
  } else {
    solBtn.className = "btn solution disabled";
    solBtn.textContent = "풀이 없음";
  }
  actions.appendChild(solBtn);

  c.appendChild(actions);
  return c;
}

function openViewer(title, path) {
  el.viewerTitle.textContent = title || "";
  el.viewerOpen.href = path;
  el.viewerDownload.href = path;
  el.viewerFrame.src = path;
  el.viewer.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeViewer() {
  el.viewer.hidden = true;
  el.viewerFrame.src = "about:blank";
  document.body.style.overflow = "";
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
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

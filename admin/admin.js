"use strict";

/* ============================================================
   EXAM Bank — Admin
   - GitHub Fine-grained PAT in localStorage
   - Reads ../data/catalog.json (+ ../data/meta.json) for dashboard
   - Writes PDFs + meta.json as ONE commit via the Git Data API
     (paths are ALWAYS repo-root relative: "pdfs/...", "data/meta.json")
   ============================================================ */

const LS_TOKEN = "exambank.gh.token";
const LS_REPO = "exambank.gh.repo";
const API = "https://api.github.com";

const SUBJECTS = ["수학", "국어", "영어", "과학", "사회", "한국사", "기타"];

const state = {
  token: "",
  owner: "",
  repo: "",
  branch: "main",
  user: null,
  catalog: { version: 2, count: 0, sets: [] },
  meta: {},
  newTags: [],
  newProbFiles: [],
  newGroups: [], // [{ name, files: [File] }]
  addFiles: [],
  metaTags: [],
  metaHidden: false,
  busy: false,
};

const $ = (id) => document.getElementById(id);

/* ---------------- boot ---------------- */
document.addEventListener("DOMContentLoaded", init);

function init() {
  loadSettings();
  bindGlobal();
  bindSettings();
  bindTabs();
  bindNewSet();
  bindAddToSet();
  bindMeta();
  refreshAll();
}

/* ---------------- settings / auth ---------------- */
function guessRepo() {
  // runfekim.github.io/exam-bank → owner=runfekim, repo=exam-bank
  const host = location.hostname;
  const m = host.match(/^([^.]+)\.github\.io$/i);
  if (m) {
    const owner = m[1];
    const seg = location.pathname.split("/").filter(Boolean);
    const repo = seg.length ? seg[0] : `${owner}.github.io`;
    return { owner, repo, branch: "main" };
  }
  return { owner: "Runfekim", repo: "exam-bank", branch: "main" };
}

function loadSettings() {
  state.token = localStorage.getItem(LS_TOKEN) || "";
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_REPO) || "null"); } catch { /* ignore */ }
  const g = guessRepo();
  state.owner = (saved && saved.owner) || g.owner;
  state.repo = (saved && saved.repo) || g.repo;
  state.branch = (saved && saved.branch) || g.branch;

  $("pat").value = state.token;
  $("owner").value = state.owner;
  $("repo").value = state.repo;
  $("branch").value = state.branch;
}

function saveRepoSettings() {
  state.owner = $("owner").value.trim();
  state.repo = $("repo").value.trim();
  state.branch = $("branch").value.trim() || "main";
  localStorage.setItem(LS_REPO, JSON.stringify({ owner: state.owner, repo: state.repo, branch: state.branch }));
}

function bindSettings() {
  $("pat-toggle").addEventListener("click", () => {
    const i = $("pat");
    const show = i.type === "password";
    i.type = show ? "text" : "password";
    $("pat-toggle").textContent = show ? "숨김" : "표시";
  });

  $("connect-btn").addEventListener("click", connect);
  $("logout-btn").addEventListener("click", logout);

  // initial badge state
  if (state.token) verifyToken();
  else setAuthBadge(false);
}

async function connect() {
  const token = $("pat").value.trim();
  if (!token) { toast("danger", "PAT 를 입력하세요."); return; }
  saveRepoSettings();
  if (!state.owner || !state.repo) { toast("danger", "owner / repo 를 입력하세요."); return; }
  state.token = token;
  localStorage.setItem(LS_TOKEN, token);
  await verifyToken();
  refreshAll();
}

async function verifyToken() {
  try {
    const res = await fetch(`${API}/user`, { headers: ghHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const u = await res.json();
    state.user = u;
    setAuthBadge(true, u.login);
    toast("success", `연결됨 — ${u.login}`);
    await verifyRepoAccess();
  } catch (e) {
    state.user = null;
    setAuthBadge(false);
    toast("danger", `토큰 검증 실패: ${e.message}. 권한·만료를 확인하세요.`);
  }
}

// Confirm the token actually has push (write) access to THIS repo,
// so an unprivileged token can't look "connected" then 403 on the first commit.
async function verifyRepoAccess() {
  if (!state.owner || !state.repo) return;
  try {
    const res = await fetch(`${API}/repos/${state.owner}/${state.repo}`, { headers: ghHeaders() });
    if (!res.ok) {
      toast("warn", `저장소 ${state.owner}/${state.repo} 에 접근할 수 없습니다 (HTTP ${res.status}). owner/repo 와 토큰 권한을 확인하세요.`);
      return;
    }
    const repo = await res.json();
    const canPush = !!(repo.permissions && repo.permissions.push === true);
    if (!canPush) {
      const line = $("user-line");
      if (line.textContent) line.textContent += " · ⚠ 쓰기 권한 없음";
      toast("danger", "이 저장소에 쓰기 권한이 없습니다. Fine-grained PAT 의 Contents: Read and write 권한을 확인하세요. (업로드 시 403 이 발생합니다.)");
    }
  } catch (e) {
    toast("warn", `저장소 권한 확인 실패: ${e.message}`);
  }
}

function setAuthBadge(ok, login) {
  const b = $("auth-badge");
  b.className = "badge " + (ok ? "success" : "danger");
  b.textContent = ok ? "연결됨" : "미연결";
  $("logout-btn").hidden = !ok;
  $("user-line").textContent = ok && login ? `로그인: ${login} · ${state.owner}/${state.repo}@${state.branch}` : "";
}

function logout() {
  if (state.busy) { toast("warn", "작업이 진행 중입니다. 완료 후 로그아웃하세요."); return; }
  localStorage.removeItem(LS_TOKEN);
  state.token = "";
  state.user = null;
  $("pat").value = "";
  setAuthBadge(false);
  toast("warn", "로그아웃되었습니다. 이 브라우저에서 토큰을 삭제했습니다.");
}

function ghHeaders(extra) {
  return Object.assign({
    "Authorization": `Bearer ${state.token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }, extra || {});
}

/* ---------------- dashboard / catalog ---------------- */
async function refreshAll() {
  await Promise.all([loadCatalog(), loadMeta()]);
  renderStats();
  renderTable();
  renderSetSelectors();
  await loadLastCommit();
}

async function loadCatalog() {
  try {
    const res = await fetch(`../data/catalog.json?_=${Date.now()}`, { cache: "no-cache" });
    const data = await res.json();
    state.catalog = data && Array.isArray(data.sets) ? data : { version: 2, count: 0, sets: [] };
  } catch {
    state.catalog = { version: 2, count: 0, sets: [] };
  }
}

async function loadMeta() {
  try {
    const res = await fetch(`../data/meta.json?_=${Date.now()}`, { cache: "no-cache" });
    state.meta = res.ok ? (await res.json()) : {};
    if (!state.meta || typeof state.meta !== "object") state.meta = {};
  } catch {
    state.meta = {};
  }
}

async function loadLastCommit() {
  if (!state.token || !state.owner) { $("stat-build").textContent = "–"; return; }
  try {
    const res = await fetch(`${API}/repos/${state.owner}/${state.repo}/commits?sha=${encodeURIComponent(state.branch)}&per_page=1`, { headers: ghHeaders() });
    if (!res.ok) throw new Error();
    const arr = await res.json();
    if (Array.isArray(arr) && arr[0]) {
      const c = arr[0];
      const d = new Date(c.commit.author.date);
      $("stat-build").textContent = d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      $("stat-build").title = `${c.sha.slice(0, 7)} — ${c.commit.message.split("\n")[0]}`;
    }
  } catch {
    $("stat-build").textContent = "–";
  }
}

function renderStats() {
  const sets = state.catalog.sets || [];
  const p = sets.reduce((n, s) => n + (s.problemCount || (s.problems || []).length), 0);
  const sol = sets.reduce((n, s) => n + (s.solutionCount || (s.solutionGroups || []).reduce((m, g) => m + (g.items || []).length, 0)), 0);
  $("stat-sets").textContent = sets.length;
  $("stat-problems").textContent = p;
  $("stat-solutions").textContent = sol;
}

function renderTable() {
  const tbody = $("set-rows");
  const sets = state.catalog.sets || [];
  tbody.innerHTML = "";
  $("list-empty").hidden = sets.length > 0;

  for (const s of sets) {
    const tr = document.createElement("tr");

    const tdTitle = document.createElement("td");
    tdTitle.innerHTML = `<div class="row-title"></div><div class="row-id"></div>`;
    tdTitle.querySelector(".row-title").textContent = s.title || s.id;
    tdTitle.querySelector(".row-id").textContent = s.id;
    tr.appendChild(tdTitle);

    const tdSubj = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.setAttribute("data-subject", s.subject || "기타");
    badge.style.background = "var(--accent-soft)";
    badge.style.color = "var(--accent-soft-ink)";
    badge.style.borderColor = "transparent";
    badge.textContent = s.subject || "기타";
    tdSubj.appendChild(badge);
    tr.appendChild(tdSubj);

    const tdP = document.createElement("td");
    tdP.className = "num"; tdP.dataset.label = "문제";
    tdP.textContent = s.problemCount != null ? s.problemCount : (s.problems || []).length;
    tr.appendChild(tdP);

    const tdS = document.createElement("td");
    tdS.className = "num"; tdS.dataset.label = "풀이";
    tdS.textContent = s.solutionCount != null ? s.solutionCount : (s.solutionGroups || []).reduce((m, g) => m + (g.items || []).length, 0);
    tr.appendChild(tdS);

    const tdAct = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "row-actions";
    const editBtn = document.createElement("button");
    editBtn.className = "btn ghost btn-sm";
    editBtn.textContent = "메타 편집";
    editBtn.addEventListener("click", () => openMetaFor(s.id));
    const delBtn = document.createElement("button");
    delBtn.className = "btn danger btn-sm";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", () => confirmDeleteSet(s));
    wrap.append(editBtn, delBtn);
    tdAct.appendChild(wrap);
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  }
}

function setById(id) { return (state.catalog.sets || []).find((s) => s.id === id); }

/* ---------------- tabs ---------------- */
function bindTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
      btn.classList.add("active"); btn.setAttribute("aria-selected", "true");
      const tab = btn.dataset.tab;
      $("panel-new").hidden = tab !== "new";
      $("panel-add").hidden = tab !== "add";
      $("panel-meta").hidden = tab !== "meta";
    });
  });
}

function activateTab(tab) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (btn) btn.click();
}

/* ---------------- selectors for add/meta ---------------- */
function renderSetSelectors() {
  const sets = state.catalog.sets || [];
  for (const selId of ["add-set", "meta-set"]) {
    const sel = $(selId);
    const prev = sel.value;
    sel.innerHTML = "";
    if (!sets.length) {
      const o = document.createElement("option");
      o.value = ""; o.textContent = "— 세트 없음 —";
      sel.appendChild(o);
      continue;
    }
    for (const s of sets) {
      const o = document.createElement("option");
      o.value = s.id; o.textContent = s.title || s.id;
      sel.appendChild(o);
    }
    if (prev && sets.some((s) => s.id === prev)) sel.value = prev;
  }
  syncAddGroupList();
}

/* ============================================================
   TAB 1 — 새 세트 만들기
   ============================================================ */
function bindNewSet() {
  // id auto-fill from title (until user edits id)
  let idEdited = false;
  $("new-id").addEventListener("input", () => { idEdited = true; });
  $("new-title").addEventListener("input", () => {
    if (!idEdited) $("new-id").value = $("new-title").value.trim();
  });

  bindTagInput($("new-tags-input"), state.newTags, $("new-tags"));

  bindDrop($("new-prob-drop"), $("new-prob-input"), (files) => {
    state.newProbFiles.push(...files);
    renderFileList($("new-prob-files"), state.newProbFiles);
  });

  $("new-add-group").addEventListener("click", () => addGroupBlock());
  addGroupBlock("공통");

  $("new-submit").addEventListener("click", submitNewSet);
}

function addGroupBlock(name) {
  const g = { name: name || "", files: [] };
  state.newGroups.push(g);
  const host = $("new-groups");

  const block = document.createElement("div");
  block.className = "group-block";

  const head = document.createElement("div");
  head.className = "group-block-head";
  const input = document.createElement("input");
  input.className = "input";
  input.placeholder = "그룹명 (예: 공통, 미적분)";
  input.value = g.name;
  input.addEventListener("input", () => { g.name = input.value.trim(); });
  const rm = document.createElement("button");
  rm.className = "btn ghost btn-sm";
  rm.textContent = "그룹 삭제";
  rm.addEventListener("click", () => {
    const i = state.newGroups.indexOf(g);
    if (i >= 0) state.newGroups.splice(i, 1);
    block.remove();
  });
  head.append(input, rm);

  const drop = document.createElement("div");
  drop.className = "dropzone";
  drop.tabIndex = 0; drop.setAttribute("role", "button");
  drop.innerHTML = `<span>이 그룹의 풀이 PDF 추가 (여러 개)</span>`;
  const fileInput = document.createElement("input");
  fileInput.type = "file"; fileInput.accept = "application/pdf,.pdf"; fileInput.multiple = true; fileInput.hidden = true;
  drop.appendChild(fileInput);

  const list = document.createElement("ul");
  list.className = "file-list";

  bindDrop(drop, fileInput, (files) => {
    g.files.push(...files);
    renderFileList(list, g.files);
  });

  block.append(head, drop, list);
  host.appendChild(block);
}

async function submitNewSet() {
  if (!ensureAuth()) return;
  clearErr("new-title-err", "new-title"); clearErr("new-id-err", "new-id");

  const title = $("new-title").value.trim();
  let id = $("new-id").value.trim() || title;
  const subject = $("new-subject").value;

  let bad = false;
  if (!title) { showErr("new-title-err", "new-title", "제목을 입력하세요."); bad = true; }
  if (!id) { showErr("new-id-err", "new-id", "폴더 id 를 입력하세요."); bad = true; }
  if (/[\/\\]/.test(id)) { showErr("new-id-err", "new-id", "id 에 / \\ 는 쓸 수 없습니다."); bad = true; }
  if (setById(id)) { showErr("new-id-err", "new-id", "이미 존재하는 id 입니다."); bad = true; }
  if (bad) return;

  const hasProb = state.newProbFiles.length > 0;
  const hasSol = state.newGroups.some((g) => g.name && g.files.length);
  if (!hasProb && !hasSol) { toast("danger", "문제지 또는 풀이 PDF 를 1개 이상 추가하세요."); return; }

  // build file tree (root-relative paths)
  const files = [];
  for (const f of state.newProbFiles) {
    files.push({ path: `pdfs/${id}/${safeName(f.name)}`, file: f });
  }
  for (const g of state.newGroups) {
    if (!g.files.length) continue;
    const gname = safeGroup(g.name);
    if (!gname) { toast("danger", "그룹명이 올바르지 않습니다 (빈 값 또는 '.', '..'). 그룹명을 확인하세요."); return; }
    for (const f of g.files) {
      files.push({ path: `pdfs/${id}/${gname}/${safeName(f.name)}`, file: f });
    }
  }
  if (!files.length) { toast("danger", "유효한 PDF 가 없습니다 (그룹명을 확인하세요)."); return; }

  // meta.json entry
  const groupOrder = state.newGroups
    .filter((g) => g.files.length && safeGroup(g.name))
    .map((g) => safeGroup(g.name));
  const metaEntry = { title, subject, tags: state.newTags.slice() };
  if (groupOrder.length) metaEntry.groupOrder = groupOrder;

  try {
    const sha = await commitChange({
      message: `admin: 새 세트 추가 — ${title}`,
      uploads: files,
      metaMutator: (meta) => { meta[id] = metaEntry; },
    });
    onCommitDone(sha, "세트가 추가되었습니다");
    // reset form
    state.newTags.length = 0; state.newProbFiles.length = 0; state.newGroups.length = 0;
    $("new-title").value = ""; $("new-id").value = "";
    $("new-tags").innerHTML = ""; $("new-prob-files").innerHTML = ""; $("new-groups").innerHTML = "";
    addGroupBlock("공통");
  } catch (e) {
    onCommitError(e);
  }
}

/* ============================================================
   TAB 2 — 기존 세트에 추가
   ============================================================ */
function bindAddToSet() {
  $("add-set").addEventListener("change", syncAddGroupList);
  $("add-kind").addEventListener("change", () => {
    const isSol = $("add-kind").value === "solution";
    $("add-group-field").style.display = isSol ? "" : "none";
  });
  bindDrop($("add-drop"), $("add-input"), (files) => {
    state.addFiles.push(...files);
    renderFileList($("add-files"), state.addFiles);
  });
  $("add-submit").addEventListener("click", submitAddToSet);
}

function syncAddGroupList() {
  const s = setById($("add-set").value);
  const dl = $("add-group-list");
  dl.innerHTML = "";
  if (!s) return;
  for (const g of (s.solutionGroups || [])) {
    const o = document.createElement("option");
    o.value = g.group;
    dl.appendChild(o);
  }
}

async function submitAddToSet() {
  if (!ensureAuth()) return;
  const s = setById($("add-set").value);
  if (!s) { toast("danger", "세트를 선택하세요."); return; }
  if (!state.addFiles.length) { toast("danger", "PDF 를 1개 이상 추가하세요."); return; }

  const kind = $("add-kind").value;
  const files = [];
  if (kind === "problem") {
    for (const f of state.addFiles) files.push({ path: `pdfs/${s.id}/${safeName(f.name)}`, file: f });
  } else {
    const group = safeGroup($("add-group").value);
    if (!group) { toast("danger", "그룹명을 선택하거나 입력하세요 (빈 값 또는 '.', '..' 불가)."); return; }
    for (const f of state.addFiles) files.push({ path: `pdfs/${s.id}/${group}/${safeName(f.name)}`, file: f });
  }

  try {
    const sha = await commitChange({
      message: `admin: ${s.title} 에 ${kind === "problem" ? "문제지" : "풀이"} 추가 (${files.length}개)`,
      uploads: files,
    });
    onCommitDone(sha, "파일이 추가되었습니다");
    state.addFiles.length = 0;
    $("add-files").innerHTML = "";
  } catch (e) {
    onCommitError(e);
  }
}

/* ============================================================
   TAB 3 — 메타 편집
   ============================================================ */
function bindMeta() {
  $("meta-set").addEventListener("change", () => loadMetaForm($("meta-set").value));
  bindTagInput($("meta-tags-input"), state.metaTags, $("meta-tags"));

  const tog = $("meta-hidden-toggle");
  const flip = () => {
    state.metaHidden = !state.metaHidden;
    tog.classList.toggle("on", state.metaHidden);
    tog.setAttribute("aria-checked", String(state.metaHidden));
  };
  tog.addEventListener("click", flip);
  tog.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); } });

  $("meta-submit").addEventListener("click", submitMeta);
}

function openMetaFor(id) {
  activateTab("meta");
  $("meta-set").value = id;
  loadMetaForm(id);
  $("panel-meta").scrollIntoView({ behavior: "smooth", block: "start" });
}

function loadMetaForm(id) {
  const s = setById(id);
  const m = state.meta[id] || {};
  $("meta-title").value = (m.title != null ? m.title : (s ? s.title : "")) || "";

  // Keep the existing subject even if it's not in the whitelist, so a
  // round-trip edit doesn't silently overwrite it with "기타".
  const curSubject = (m.subject != null ? m.subject : (s ? s.subject : "")) || "기타";
  const subjSel = $("meta-subject");
  [...subjSel.options].forEach((o) => { if (o.dataset.custom === "1") o.remove(); });
  if (!SUBJECTS.includes(curSubject)) {
    const o = document.createElement("option");
    o.value = curSubject; o.textContent = curSubject; o.dataset.custom = "1";
    subjSel.appendChild(o);
  }
  subjSel.value = curSubject;

  state.metaTags.length = 0;
  const tags = Array.isArray(m.tags) ? m.tags : (s ? s.tags : []) || [];
  state.metaTags.push(...tags);
  renderTagChips($("meta-tags"), state.metaTags, $("meta-tags-input"));

  const order = Array.isArray(m.groupOrder)
    ? m.groupOrder
    : (s ? (s.solutionGroups || []).map((g) => g.group) : []);
  $("meta-grouporder").value = order.join(", ");

  state.metaHidden = !!m.hidden;
  const tog = $("meta-hidden-toggle");
  tog.classList.toggle("on", state.metaHidden);
  tog.setAttribute("aria-checked", String(state.metaHidden));
}

async function submitMeta() {
  if (!ensureAuth()) return;
  const id = $("meta-set").value;
  if (!id) { toast("danger", "세트를 선택하세요."); return; }

  // Build the entry incrementally so meta.json stays minimal/intentional:
  // omit empty title, only include tags/groupOrder/hidden when meaningful.
  const entry = {};
  const metaTitle = $("meta-title").value.trim();
  if (metaTitle) entry.title = metaTitle;
  entry.subject = $("meta-subject").value;
  const metaTags = state.metaTags.slice();
  if (metaTags.length) entry.tags = metaTags;
  const order = $("meta-grouporder").value.split(",").map((x) => x.trim()).filter(Boolean);
  if (order.length) entry.groupOrder = order;
  if (state.metaHidden) entry.hidden = true;

  try {
    const sha = await commitChange({
      message: `admin: ${entry.title || id} 메타 수정`,
      uploads: [],
      metaMutator: (meta) => { meta[id] = entry; },
    });
    onCommitDone(sha, "meta.json 저장됨");
  } catch (e) {
    onCommitError(e);
  }
}

/* ============================================================
   DELETE SET
   ============================================================ */
function confirmDeleteSet(s) {
  const paths = collectSetPaths(s);
  openConfirm(
    `“${s.title || s.id}” 삭제`,
    `이 세트의 PDF ${paths.length}개와 <code>meta.json</code> 의 <code>${escapeHtml(s.id)}</code> 항목을 삭제합니다. 되돌릴 수 없습니다.`,
    async () => {
      if (!ensureAuth()) return;
      try {
        const sha = await commitChange({
          message: `admin: 세트 삭제 — ${s.title || s.id}`,
          uploads: [],
          deletes: paths,
          metaMutator: (meta) => { delete meta[s.id]; },
        });
        onCommitDone(sha, "세트가 삭제되었습니다");
      } catch (e) {
        onCommitError(e);
      }
    }
  );
}

function collectSetPaths(s) {
  const out = [];
  for (const p of (s.problems || [])) if (p.pdf) out.push(p.pdf);
  for (const g of (s.solutionGroups || [])) for (const it of (g.items || [])) if (it.pdf) out.push(it.pdf);
  return out;
}

/* ============================================================
   GitHub Git Data API — multi-file single commit
   uploads: [{ path, file }]   deletes: ["pdfs/..."]   metaMutator(meta)
   ============================================================ */
async function commitChange({ message, uploads = [], deletes = [], metaMutator = null }) {
  setBusy(true);
  try {

  // build meta blob first (string, base64)
  let metaTreeItem = null;
  if (metaMutator) {
    const meta = JSON.parse(JSON.stringify(state.meta || {}));
    metaMutator(meta);
    state._pendingMeta = meta;
    const metaStr = JSON.stringify(meta, null, 2) + "\n";
    progress("meta.json 준비 중…", 5);
    const metaBlob = await gh("POST", `/git/blobs`, { content: b64(utf8Bytes(metaStr)), encoding: "base64" });
    metaTreeItem = { path: "data/meta.json", mode: "100644", type: "blob", sha: metaBlob.sha };
  }

  // upload pdf blobs
  const treeItems = [];
  const total = uploads.length || 1;
  for (let i = 0; i < uploads.length; i++) {
    const u = uploads[i];
    progress(`PDF 업로드 ${i + 1}/${uploads.length} — ${u.file.name}`, 10 + Math.round((i / total) * 60));
    const buf = await u.file.arrayBuffer();
    const blob = await gh("POST", `/git/blobs`, { content: bytesToB64(new Uint8Array(buf)), encoding: "base64" });
    treeItems.push({ path: u.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  for (const d of deletes) {
    treeItems.push({ path: d, mode: "100644", type: "blob", sha: null }); // null sha → delete
  }
  if (metaTreeItem) treeItems.push(metaTreeItem);

  // commit; retry ONLY on a ref-update (PATCH refs) conflict — a fast-forward
  // race. Other 422s (e.g. a malformed tree/path) must surface their real error.
  const doCommit = async () => {
    progress("브랜치 정보 조회…", 75);
    const ref = await gh("GET", `/git/ref/heads/${encodeURIComponent(state.branch)}`);
    const baseCommitSha = ref.object.sha;
    const baseCommit = await gh("GET", `/git/commits/${baseCommitSha}`);
    const baseTreeSha = baseCommit.tree.sha;

    progress("트리 생성…", 85);
    const tree = await gh("POST", `/git/trees`, { base_tree: baseTreeSha, tree: treeItems });

    progress("커밋 생성…", 92);
    const commit = await gh("POST", `/git/commits`, { message, tree: tree.sha, parents: [baseCommitSha] });

    progress("브랜치 갱신…", 97);
    try {
      await gh("PATCH", `/git/refs/heads/${encodeURIComponent(state.branch)}`, { sha: commit.sha });
    } catch (e) {
      e.step = "patch-ref"; // tag so only ref-update conflicts get retried
      throw e;
    }
    return commit.sha;
  };

  let sha;
  try {
    sha = await doCommit();
  } catch (e) {
    const isRefConflict =
      e.status === 409 ||
      (e.status === 422 && (e.step === "patch-ref" || /fast[\s-]?forward/i.test(e.message || "")));
    if (isRefConflict) {
      progress("충돌 감지 — 재시도…", 80);
      sha = await doCommit();
    } else {
      throw e; // surface the original error (e.g. bad tree/path 422)
    }
  }

  // commit to local meta cache on success
  if (state._pendingMeta) { state.meta = state._pendingMeta; state._pendingMeta = null; }
  progress("완료", 100);
  return sha;
  } finally {
    // Always release the UI lock + reset progress, even if a commit step threw.
    state._pendingMeta = null;
    setBusy(false);
  }
}

async function gh(method, path, body) {
  const url = path.startsWith("http") ? path : `${API}/repos/${state.owner}/${state.repo}${path}`;
  const res = await fetch(url, {
    method,
    headers: ghHeaders(body ? { "Content-Type": "application/json" } : null),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try { const j = await res.json(); detail = j.message || JSON.stringify(j); } catch { /* ignore */ }
    const err = new Error(`GitHub ${method} ${path} 실패 (HTTP ${res.status})${detail ? " — " + detail : ""}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

function onCommitDone(sha, label) {
  const short = sha ? sha.slice(0, 7) : "";
  const actionsUrl = `https://github.com/${state.owner}/${state.repo}/actions`;
  toast("success",
    `<span class="toast-strong">${escapeHtml(label)} · ${short}</span>` +
    `커밋 완료. <a href="${actionsUrl}" target="_blank" rel="noopener">Actions 에서 배포 진행</a> · 사이트 반영까지 약 1~2분.`
  );
  refreshAll();
}

function onCommitError(e) {
  // setBusy(false) is handled by commitChange()'s finally — avoid double toggle.
  toast("danger", escapeHtml(e.message || "알 수 없는 오류"));
}

/* ============================================================
   shared UI helpers
   ============================================================ */
function ensureAuth() {
  if (!state.token) { toast("danger", "먼저 PAT 로 연결하세요."); return false; }
  if (!state.owner || !state.repo) { toast("danger", "owner / repo 설정을 확인하세요."); return false; }
  if (state.busy) { toast("warn", "작업이 진행 중입니다."); return false; }
  return true;
}

function setBusy(busy) {
  state.busy = busy;
  $("progress-modal").hidden = !busy;
  document.querySelectorAll(".btn.problem, .btn.danger").forEach((b) => { b.disabled = busy; });
  if (!busy) { $("progress-bar").style.width = "0%"; }
}

function progress(step, pct) {
  $("progress-step").textContent = step;
  if (pct != null) $("progress-bar").style.width = Math.max(0, Math.min(100, pct)) + "%";
}

function bindGlobal() {
  $("refresh-btn").addEventListener("click", () => { toast("info", "새로고침 중…"); refreshAll(); });

  // confirm modal
  $("confirm-cancel").addEventListener("click", closeConfirm);
  $("confirm-modal").addEventListener("click", (e) => { if (e.target === $("confirm-modal")) closeConfirm(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("confirm-modal").hidden) closeConfirm();
  });
}

let confirmCb = null;
function openConfirm(title, bodyHtml, cb) {
  $("confirm-title").textContent = title;
  $("confirm-body").innerHTML = bodyHtml;
  confirmCb = cb;
  $("confirm-modal").hidden = false;
  $("confirm-ok").focus();
  $("confirm-ok").onclick = () => { closeConfirm(); if (confirmCb) confirmCb(); };
}
function closeConfirm() { $("confirm-modal").hidden = true; confirmCb = null; }

function toast(kind, html) {
  const t = document.createElement("div");
  t.className = "toast " + (kind || "");
  t.innerHTML = html;
  $("toast-stack").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 250); }, kind === "danger" ? 9000 : 6000);
}

function showErr(errId, inputId, msg) { const e = $(errId); e.textContent = msg; e.hidden = false; $(inputId).classList.add("error"); }
function clearErr(errId, inputId) { const e = $(errId); e.hidden = true; $(inputId).classList.remove("error"); }

/* ---- tag input ---- */
function bindTagInput(input, arr, host) {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const v = input.value.trim().replace(/^#/, "");
      if (v && !arr.includes(v)) { arr.push(v); renderTagChips(host, arr, input); }
      input.value = "";
    } else if (e.key === "Backspace" && !input.value && arr.length) {
      arr.pop(); renderTagChips(host, arr, input);
    }
  });
}
function renderTagChips(host, arr, input) {
  host.innerHTML = "";
  arr.forEach((tag, i) => {
    const chip = document.createElement("span");
    chip.className = "chip-removable";
    chip.append(document.createTextNode("#" + tag));
    const x = document.createElement("button");
    x.type = "button"; x.setAttribute("aria-label", `${tag} 제거`);
    x.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
    x.addEventListener("click", () => { arr.splice(i, 1); renderTagChips(host, arr, input); });
    chip.appendChild(x);
    host.appendChild(chip);
  });
}

/* ---- drop / file inputs ---- */
function bindDrop(zone, input, onFiles) {
  const pick = () => input.click();
  zone.addEventListener("click", (e) => { if (e.target.closest(".dropzone") && e.target.tagName !== "INPUT") pick(); });
  zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
  input.addEventListener("change", () => { onFiles(filterPdfs([...input.files])); input.value = ""; });
  ["dragover", "dragenter"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("dragover"); }));
  ["dragleave", "dragend", "drop"].forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove("dragover")));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = filterPdfs([...(e.dataTransfer.files || [])]);
    if (files.length) onFiles(files);
  });
}
function filterPdfs(files) {
  const ok = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
  if (ok.length < files.length) toast("warn", "PDF 가 아닌 파일은 제외되었습니다.");
  return ok;
}
function renderFileList(host, arr) {
  host.innerHTML = "";
  arr.forEach((f, i) => {
    const li = document.createElement("li");
    li.className = "file-row";
    li.innerHTML =
      `<svg class="file-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5h5"/><path d="M7 3h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/></svg>` +
      `<span class="file-name"></span><span class="file-size"></span>`;
    li.querySelector(".file-name").textContent = f.name;
    li.querySelector(".file-size").textContent = formatSize(f.size);
    const rm = document.createElement("button");
    rm.className = "icon-btn"; rm.type = "button"; rm.setAttribute("aria-label", "제거");
    rm.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>`;
    rm.addEventListener("click", () => { arr.splice(i, 1); renderFileList(host, arr); });
    li.appendChild(rm);
    host.appendChild(li);
  });
}

/* ---- encoding helpers ---- */
function utf8Bytes(str) { return new TextEncoder().encode(str); }
// btoa over a binary string built from a utf8 byte array (for JSON text)
function b64(bytes) { return bytesToB64(bytes); }
// chunked btoa to avoid call-stack overflow on large PDFs
function bytesToB64(bytes) {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

function safeName(name) { return name.replace(/[\/\\]/g, "_").trim(); }
// Normalize a group/folder name so it can't escape the set folder ("../") or
// create unintended nested folders. Returns "" for invalid names (".", "..").
function safeGroup(name) {
  const g = String(name).replace(/[\/\\]/g, "_").trim();
  return (g === "." || g === "..") ? "" : g;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function formatSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

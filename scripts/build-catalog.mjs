#!/usr/bin/env node
// pdfs/<세트>/ 구조를 스캔해 data/catalog.json (v2, 세트 모델) 을 생성합니다.
//
// 폴더 규칙
//   pdfs/<세트이름>/                     ← 한 "세트"(문제집) = 한 폴더
//     <문제지>.pdf                       ← 세트 폴더 바로 아래의 PDF = 문제(problem)
//     <그룹>/<풀이>.pdf                  ← 하위 폴더 안의 PDF = 풀이(solution), 폴더명 = 그룹
//
//   예) pdfs/수능수학_2026_풀이/수학영역_문제지.pdf      (문제)
//       pdfs/수능수학_2026_풀이/공통/공통_01.pdf          (풀이 · 그룹=공통 · 라벨=01)
//
// data/meta.json 으로 세트별 title/subject/tags/hidden/order/groupOrder 를 덮어쓸 수 있습니다.
//
// 실행:  node scripts/build-catalog.mjs

import { readdir, writeFile, stat, mkdir, readFile } from "node:fs/promises";
import { join, relative, sep, posix, basename } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pdfsDir = join(root, "pdfs");
const outFile = join(root, "data", "catalog.json");
const metaFile = join(root, "data", "meta.json");

const isPdf = (n) => n.toLowerCase().endsWith(".pdf");
const toPosix = (p) => p.split(sep).join(posix.sep);
const stem = (n) => n.replace(/\.pdf$/i, "");
const pretty = (s) => s.replace(/_+/g, " ").trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 숫자 인식 정렬: 공통_2 < 공통_10
const coll = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

async function listDir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function walkPdfs(dir) {
  const out = [];
  for (const e of await listDir(dir)) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkPdfs(full)));
    else if (e.isFile() && isPdf(e.name)) out.push(full);
  }
  return out;
}

let meta = {};
if (existsSync(metaFile)) {
  try {
    meta = JSON.parse(await readFile(metaFile, "utf8"));
  } catch (e) {
    console.warn("⚠️  meta.json 파싱 실패 — 무시하고 진행:", e.message);
  }
}

const sets = [];

for (const e of await listDir(pdfsDir)) {
  if (e.name.startsWith(".") || !e.isDirectory()) continue;
  const setId = e.name;
  const setDir = join(pdfsDir, setId);
  const m = meta[setId] || {};
  if (m.hidden) continue;

  // 문제지: 세트 폴더 바로 아래의 .pdf
  const problems = [];
  for (const f of await listDir(setDir)) {
    if (f.name.startsWith(".") || !f.isFile() || !isPdf(f.name)) continue;
    const full = join(setDir, f.name);
    const { size } = await stat(full);
    problems.push({ label: pretty(stem(f.name)), pdf: toPosix(relative(root, full)), size });
  }
  problems.sort((a, b) => coll.compare(a.label, b.label));

  // 풀이: 하위 폴더별 그룹
  const groupsMap = new Map();
  for (const sub of await listDir(setDir)) {
    if (sub.name.startsWith(".") || !sub.isDirectory()) continue;
    const group = sub.name;
    const items = [];
    for (const full of await walkPdfs(join(setDir, group))) {
      const { size } = await stat(full);
      const fileStem = stem(basename(full));
      // "공통_01" → "01" (그룹 접두사 제거)
      let label = pretty(fileStem.replace(new RegExp("^" + escapeRe(group) + "[ _-]+"), ""));
      if (!label) label = pretty(fileStem);
      items.push({ label, pdf: toPosix(relative(root, full)), size, _sort: fileStem });
    }
    // 정렬은 원본 파일 stem 기준 — 접두사 유무/패딩 혼재에도 안정적(라벨 기준보다 견고)
    items.sort((a, b) => coll.compare(a._sort, b._sort));
    items.forEach((it) => delete it._sort);
    if (items.length) groupsMap.set(group, items);
  }

  // 그룹 순서: meta.groupOrder 우선 → "공통" 먼저 → ko 정렬
  const order = Array.isArray(m.groupOrder) ? m.groupOrder : null;
  const groups = [...groupsMap.keys()].sort((a, b) => {
    if (order) {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
    }
    const pa = a === "공통" ? 0 : 1;
    const pb = b === "공통" ? 0 : 1;
    return pa - pb || coll.compare(a, b);
  });

  const solutionGroups = groups.map((g) => ({ group: g, items: groupsMap.get(g) }));
  const solutionCount = solutionGroups.reduce((n, g) => n + g.items.length, 0);

  if (!problems.length && !solutionCount) continue; // 빈 폴더 skip

  sets.push({
    id: setId,
    title: m.title || pretty(setId),
    subject: m.subject || "기타",
    tags: Array.isArray(m.tags) ? m.tags : [],
    order: typeof m.order === "number" ? m.order : 1000,
    problems,
    solutionGroups,
    problemCount: problems.length,
    solutionCount,
  });
}

sets.sort((a, b) => a.order - b.order || coll.compare(a.title, b.title));
sets.forEach((s) => delete s.order);

const catalog = { version: 2, count: sets.length, sets };
await mkdir(join(root, "data"), { recursive: true });
await writeFile(outFile, JSON.stringify(catalog, null, 2) + "\n", "utf8");

const totalP = sets.reduce((n, s) => n + s.problemCount, 0);
const totalS = sets.reduce((n, s) => n + s.solutionCount, 0);
console.log(`✅ catalog.json — 세트 ${sets.length}개 · 문제 ${totalP} · 풀이 ${totalS}`);

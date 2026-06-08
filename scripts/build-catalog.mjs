#!/usr/bin/env node
// pdfs/problems 아래의 모든 PDF를 스캔해 data/catalog.json 을 생성합니다.
//
// 규칙
//   - 문제 PDF:  pdfs/problems/<과목>/<제목>.pdf
//   - 풀이 PDF:  pdfs/solutions/<과목>/<제목>.pdf   (문제와 같은 상대경로 → 자동 연결)
//   - 과목      : problems 바로 아래 첫 번째 폴더 이름 (없으면 "기타")
//   - 제목      : 파일 이름에서 .pdf 를 뗀 것 ('-', '_' 는 공백으로)
//
// 실행:  node scripts/build-catalog.mjs

import { readdir, writeFile, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, sep, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const problemsDir = join(root, "pdfs", "problems");
const solutionsDir = join(root, "pdfs", "solutions");
const outFile = join(root, "data", "catalog.json");

async function walk(dir) {
  const found = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found; // 폴더가 아직 없으면 빈 목록
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) found.push(...(await walk(full)));
    else if (e.isFile() && e.name.toLowerCase().endsWith(".pdf")) found.push(full);
  }
  return found;
}

const toPosix = (p) => p.split(sep).join(posix.sep);

const files = (await walk(problemsDir)).sort();
const items = [];

for (const file of files) {
  const rel = toPosix(relative(problemsDir, file)); // 예: 수학/2024-모의고사-1회.pdf
  const id = rel.replace(/\.pdf$/i, "");
  const parts = id.split("/");
  const subject = parts.length > 1 ? parts[0] : "기타";
  const title = parts[parts.length - 1].replace(/[-_]+/g, " ").trim();

  const solutionFull = join(solutionsDir, ...rel.split("/"));
  const hasSolution = existsSync(solutionFull);
  const { size } = await stat(file);

  items.push({
    id,
    title,
    subject,
    tags: [],
    problemPdf: "pdfs/problems/" + rel,
    solutionPdf: hasSolution ? "pdfs/solutions/" + rel : null,
    size,
  });
}

items.sort(
  (a, b) =>
    a.subject.localeCompare(b.subject, "ko") || a.title.localeCompare(b.title, "ko")
);

const catalog = { version: 1, count: items.length, items };
await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(catalog, null, 2) + "\n", "utf8");
console.log(`✅ catalog.json 생성 완료 — ${items.length}개 자료`);

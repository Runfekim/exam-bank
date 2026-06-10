#!/usr/bin/env node
/* ============================================================
   EXAM Bank — build-search.mjs
   모든 시험의 db.json → (1) 로컬 SQLite DB  (2) 정적 검색 인덱스
   ------------------------------------------------------------
   - data/exam-bank.db      : SQLite(+FTS5 trigram). 로컬 전용(.gitignore).
                              한글·영문 부분검색 가능. 로컬 도구/질의용.
   - data/search-index.json : 공개 사이트가 1회 로드하는 컴팩트 인덱스.
                              GitHub Pages엔 서버 DB가 없으므로 이 정적
                              인덱스 + 순수 JS 검색이 "대안"이다.

   실행:  node tools/build-search.mjs
   의존:  Node 22+ 내장 node:sqlite (추가 패키지 없음)
   ============================================================ */
'use strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const EXAMS_JSON = join(DATA, 'exams.json');
const DB_PATH = join(DATA, 'exam-bank.db');
const INDEX_PATH = join(DATA, 'search-index.json');

// ---- 검색용 정규화: 마크다운/LaTeX/HTML/PUA 글리프 제거 → 평문 ----
function normalize(s) {
  if (!s) return '';
  return String(s)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')          // 이미지
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')          // 링크 → 텍스트
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')              // HTML 태그(<u> 등)
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')                // 디스플레이 수식
    .replace(/\$[^$\n]*\$/g, ' ')                     // 인라인 수식
    .replace(/\\[a-zA-Z]+/g, ' ')                     // LaTeX 명령
    .replace(/[{}$^~`#>*_|\\]/g, ' ')                 // 마크다운/수식 기호
    .replace(/[-]/g, ' ')                 // PUA 글리프(PDF 추출 잔재)
    .replace(/\s+/g, ' ')
    .trim();
}

// 표시용 스니펫(선두 일부)
function snippet(s, n = 120) {
  const t = normalize(s);
  return t.length > n ? t.slice(0, n).trimEnd() + '…' : t;
}

// ---- 시험·문항 수집 ----
const index = JSON.parse(readFileSync(EXAMS_JSON, 'utf8'));
const exams = Array.isArray(index.exams) ? index.exams : [];
const rows = [];
for (const meta of exams) {
  const dbRel = meta.db || `data/exams/${meta.id}/db.json`;
  const dbFile = join(ROOT, dbRel);
  if (!existsSync(dbFile)) { console.warn('⚠️  db.json 없음:', dbRel); continue; }
  const db = JSON.parse(readFileSync(dbFile, 'utf8'));
  const examTitle = meta.title || db.title || meta.id;
  const subject = meta.subject || db.subject || '';
  for (const q of (db.questions || [])) {
    const answer = (q.answer || q.finalAnswer || '').toString().trim();
    // 검색 대상 = 본문(body, 깔끔) 우선 + 거친 text 보강 + 메타(그룹/번호/정답)
    const baseText = q.body ? q.body : (q.text || '');
    const search = normalize(
      `${baseText} ${q.text || ''} ${examTitle} ${subject} ${q.group || ''} ${q.group || ''}${q.number || ''} ${answer}`
    ).toLowerCase();
    rows.push({
      id: q.id,
      examId: meta.id,
      examTitle,
      subject,
      group: q.group || '',
      number: q.number || 0,
      answer,
      hasBody: !!q.body,
      hasImage: !!q.image,
      snippet: snippet(baseText),
      s: search, // 클라이언트 검색 문자열(소문자·정규화)
    });
  }
}

// ---- (1) 로컬 SQLite DB (FTS5 trigram; 실패 시 일반 테이블) ----
if (existsSync(DB_PATH)) rmSync(DB_PATH);
const sdb = new DatabaseSync(DB_PATH);
sdb.exec(`
  CREATE TABLE questions (
    id TEXT, examId TEXT, examTitle TEXT, subject TEXT,
    "group" TEXT, number INTEGER, answer TEXT,
    hasBody INTEGER, hasImage INTEGER, snippet TEXT, search TEXT
  );
`);
let ftsOk = false;
try {
  sdb.exec(`CREATE VIRTUAL TABLE questions_fts USING fts5(
    id UNINDEXED, examId UNINDEXED, examTitle, "group", number UNINDEXED, search,
    tokenize='trigram'
  );`);
  ftsOk = true;
} catch (e) {
  console.warn('⚠️  FTS5(trigram) 불가 — 일반 테이블만 생성:', e.message);
}
const insQ = sdb.prepare(`INSERT INTO questions
  (id,examId,examTitle,subject,"group",number,answer,hasBody,hasImage,snippet,search)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const insF = ftsOk ? sdb.prepare(`INSERT INTO questions_fts
  (id,examId,examTitle,"group",number,search) VALUES (?,?,?,?,?,?)`) : null;
sdb.exec('BEGIN');
for (const r of rows) {
  insQ.run(r.id, r.examId, r.examTitle, r.subject, r.group, r.number, r.answer,
    r.hasBody ? 1 : 0, r.hasImage ? 1 : 0, r.snippet, r.s);
  if (insF) insF.run(r.id, r.examId, r.examTitle, r.group, r.number, r.s);
}
sdb.exec('COMMIT');
sdb.exec('CREATE INDEX idx_exam ON questions(examId)');
sdb.close();

// ---- (2) 정적 검색 인덱스(JSON) ----
const payload = {
  version: 1,
  generatedBy: 'build-search',
  count: rows.length,
  exams: exams.map((e) => ({ id: e.id, title: e.title, subject: e.subject, count: e.count })),
  questions: rows.map((r) => ({
    id: r.id, examId: r.examId, examTitle: r.examTitle, subject: r.subject,
    group: r.group, number: r.number, answer: r.answer,
    hasBody: r.hasBody, hasImage: r.hasImage, snippet: r.snippet, s: r.s,
  })),
};
writeFileSync(INDEX_PATH, JSON.stringify(payload) + '\n');

const kb = (n) => (n / 1024).toFixed(1) + 'KB';
console.log(`✅ ${rows.length}문항 / ${exams.length}시험`);
console.log(`   로컬 DB  : data/exam-bank.db ${ftsOk ? '(FTS5 trigram)' : '(일반)'}`);
console.log(`   정적 인덱스: data/search-index.json (${kb(Buffer.byteLength(JSON.stringify(payload)))})`);

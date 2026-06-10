#!/usr/bin/env node
/* ============================================================
   build-eng.mjs — 텍스트 전사형 시험(스캔 영어 등) DB 빌더
   ------------------------------------------------------------
   스캔 PDF라 자동 문항검출이 안 되는 시험을, 사람이 전사한
   JSON 스펙으로부터 db.json + 풀이(.md) + exams.json 으로 만든다.

   사용: node tools/build-eng.mjs <spec.json>
   spec.json:
   {
     "examId": "...", "title": "...", "subject": "영어",
     "pdf": "pdfs/원본.pdf", "pages": 12, "groups": ["선택형","서술형"],
     "questions": [
       { "id":"선택형-01","group":"선택형","number":1,"type":"선택형",
         "points":3.4,"text":"검색 스니펫","body":"마크다운 본문",
         "answer":"②","answerText":"occupation","page":1,
         "solution":"마크다운 풀이(없으면 pending)" }
     ]
   }
   기존 db.json 이 있으면 questions 를 id 기준 upsert(병합)한다.
   ============================================================ */
'use strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const specPath = process.argv[2];
if (!specPath) { console.error('사용: node tools/build-eng.mjs <spec.(json|mjs)>'); process.exit(1); }
const absSpec = specPath.startsWith('/') ? specPath : join(ROOT, specPath);
const spec = /\.m?js$/.test(specPath)
  ? (await import(pathToFileURL(absSpec).href)).default
  : JSON.parse(readFileSync(absSpec, 'utf8'));

const examRel = 'data/exams/' + spec.examId;
const examDir = join(ROOT, examRel);
const solDir = join(examDir, 'solutions');
mkdirSync(solDir, { recursive: true });

// 기존 db 로드(병합용)
const dbPath = join(examDir, 'db.json');
const prev = existsSync(dbPath) ? JSON.parse(readFileSync(dbPath, 'utf8')) : { questions: [] };
const byId = new Map((prev.questions || []).map((q) => [q.id, q]));

for (const q of spec.questions) {
  const rec = byId.get(q.id) || {};
  rec.id = q.id;
  rec.group = q.group;
  rec.number = q.number;
  rec.type = q.type || q.group;
  if (q.points != null) rec.points = q.points;
  rec.text = q.text || '';
  rec.body = q.body || '';
  rec.image = null;
  rec.answer = q.answer || '';
  if (q.answerText != null) rec.answerText = q.answerText;
  rec.source = { pdf: spec.pdf, page: q.page || 1 };

  if (q.solution && q.solution.trim()) {
    const solRel = examRel + '/solutions/' + q.id + '.md';
    writeFileSync(join(ROOT, examRel, 'solutions', q.id + '.md'), q.solution.trim() + '\n');
    rec.solutionMd = solRel;
    rec.solutionStatus = 'generated';
    rec.finalAnswer = q.answer || rec.finalAnswer || '';
    rec.answerMatch = q.answer ? true : null;
  } else if (!rec.solutionMd) {
    rec.solutionMd = null;
    rec.solutionStatus = 'pending';
  }
  byId.set(q.id, rec);
}

// 정렬: group 순서 → number
const groupRank = (g) => { const i = (spec.groups || []).indexOf(g); return i < 0 ? 999 : i; };
const questions = [...byId.values()].sort(
  (a, b) => (groupRank(a.group) - groupRank(b.group)) || (a.number - b.number));

const db = {
  version: 3,
  generatedBy: 'build-eng',
  title: spec.title,
  subject: spec.subject || '영어',
  source: { pdf: spec.pdf, pages: spec.pages },
  groups: spec.groups || [...new Set(questions.map((q) => q.group))],
  count: questions.length,
  questions,
};
writeFileSync(dbPath, JSON.stringify(db, null, 2) + '\n');

// exams.json upsert
const examsPath = join(ROOT, 'data', 'exams.json');
const index = existsSync(examsPath)
  ? JSON.parse(readFileSync(examsPath, 'utf8')) : { version: 1, exams: [] };
index.exams = (index.exams || []).filter((e) => e.id !== spec.examId);
index.exams.push({
  id: spec.examId, title: spec.title, subject: spec.subject || '영어',
  groups: db.groups, count: db.count,
  source: { pdf: spec.pdf, pages: spec.pages }, db: examRel + '/db.json',
});
writeFileSync(examsPath, JSON.stringify(index, null, 2) + '\n');

const pend = questions.filter((q) => q.solutionStatus !== 'generated' && q.solutionStatus !== 'ingested').length;
console.log(`✅ ${spec.examId} — ${db.count}문항 (풀이 ${db.count - pend} / 미풀이 ${pend})`);

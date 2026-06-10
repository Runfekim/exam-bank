#!/usr/bin/env node
/* ============================================================
   EXAM Bank — 로컬 어드민 서버 (local only · no deps)
   ------------------------------------------------------------
   실행:   node tools/admin-server.mjs   [--port 4321]
   접속:   http://localhost:4321/admin/        (관리자)
           http://localhost:4321/             (메인 뷰어)

   역할: 시험 PDF '등록'(문항 분해+이미지 크롭, 풀이는 pending) 전용.
        실제 분해는 비공개 스킬 exam-db-builder 의 build.mjs 를 호출한다.
        풀이 '생성'은 Claude(스킬)가 한다 — 어드민은 미풀이 목록만 보여준다.

   Node 내장 모듈만 사용(설치 불필요). 로컬 전용 — 외부 노출 금지.
   ============================================================ */
'use strict';

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import {
  existsSync, readFileSync, writeFileSync, readdirSync,
  createReadStream, statSync, rmSync, mkdirSync,
} from 'node:fs';
import { join, extname, basename, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

// ---- 경로 -----------------------------------------------------------------
const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = normalize(join(HERE, '..'));            // 저장소 루트 (data/, pdfs/ 가 있는 곳)
const PDFS_DIR = join(ROOT, 'pdfs');
const DATA_DIR = join(ROOT, 'data');
const EXAMS_JSON = join(DATA_DIR, 'exams.json');

// 비공개 스킬의 빌드 스크립트
const SKILL_DIR = join(homedir(), '.claude', 'skills', 'exam-db-builder', 'scripts');
const BUILD_SCRIPT = join(SKILL_DIR, 'build.mjs');

const argPort = (() => {
  const i = process.argv.indexOf('--port');
  if (i >= 0 && process.argv[i + 1]) return Number(process.argv[i + 1]);
  return Number(process.env.PORT) || 4321;
})();

// ---- 유틸 -----------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendText(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readBody(req, limit = 80 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const readJSONSafe = (p, fallback) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
};

// 안전한 파일명: basename 으로 디렉터리 성분 제거 + 슬래시/역슬래시/제어문자 차단
function safeName(s) {
  const base = basename(String(s || ''));
  let out = '';
  for (const ch of base) {                      // 제어문자/경로구분자 제거(한글·공백 보존)
    const c = ch.codePointAt(0);
    if (c < 0x20 || ch === '/' || ch === '\\') continue;
    out += ch;
  }
  out = out.replace(/^\.+/, '').trim();         // 선행 점 제거('.', '..' 방지)
  return out;
}

// ---- 상태 집계 ------------------------------------------------------------
const isSolved = (q) =>
  q.solutionStatus === 'generated' || q.solutionStatus === 'ingested' || !!q.solutionMd;

function buildStatus() {
  const index = readJSONSafe(EXAMS_JSON, { exams: [] });
  const exams = (index.exams || []).map((meta) => {
    const dbPath = join(ROOT, meta.db || `data/exams/${meta.id}/db.json`);
    const db = readJSONSafe(dbPath, null);
    const qs = (db && db.questions) || [];
    const pendingIds = qs.filter((q) => !isSolved(q)).map((q) => q.id);
    const solved = qs.length - pendingIds.length;
    const pdfRel = (meta.source && meta.source.pdf) || (db && db.source && db.source.pdf) || null;
    return {
      id: meta.id,
      title: meta.title || meta.id,
      subject: meta.subject || (db && db.subject) || '',
      groups: meta.groups || (db && db.groups) || [],
      count: qs.length || meta.count || 0,
      solved,
      pending: pendingIds.length,
      pendingIds,
      pdf: pdfRel,
      pdfExists: pdfRel ? existsSync(join(ROOT, pdfRel)) : false,
      hasDb: !!db,
    };
  });

  // pdfs/ 폴더의 PDF 목록 (등록 여부 표시)
  const registeredPdfs = new Set(exams.map((e) => e.pdf).filter(Boolean).map((p) => basename(p)));
  let pdfs = [];
  if (existsSync(PDFS_DIR)) {
    pdfs = readdirSync(PDFS_DIR)
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .map((name) => {
        const st = statSync(join(PDFS_DIR, name));
        return {
          name,
          sizeKB: Math.round(st.size / 1024),
          registered: registeredPdfs.has(name),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  return {
    skillFound: existsSync(BUILD_SCRIPT),
    root: ROOT,
    totals: {
      exams: exams.length,
      questions: exams.reduce((n, e) => n + e.count, 0),
      pending: exams.reduce((n, e) => n + e.pending, 0),
    },
    exams,
    pdfs,
  };
}

// ---- 빌드(등록) 실행 ------------------------------------------------------
function runBuild(args) {
  return new Promise((resolve) => {
    const child = spawn('node', [BUILD_SCRIPT, ...args], { cwd: ROOT });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (err) => resolve({ code: -1, output: `실행 실패: ${err.message}` }));
    child.on('close', (code) => resolve({ code, output: out }));
  });
}

// ---- 정적 파일 서빙 -------------------------------------------------------
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  if (rel.endsWith('/')) rel += 'index.html';

  // 루트 밖 접근 차단
  const target = normalize(join(ROOT, rel));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    return sendText(res, 403, 'forbidden');
  }
  if (!existsSync(target) || statSync(target).isDirectory()) {
    return sendText(res, 404, 'not found');
  }
  const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  createReadStream(target).pipe(res);
}

// ---- 라우터 ---------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${argPort}`);
  const p = url.pathname;

  try {
    // ---- API ----
    if (p === '/api/status' && req.method === 'GET') {
      return sendJSON(res, 200, buildStatus());
    }

    // PDF 업로드: PUT /api/pdf?name=<파일명>  (본문 = 원시 바이트)
    if (p === '/api/pdf' && req.method === 'PUT') {
      const name = safeName(url.searchParams.get('name'));
      if (!name || !name.toLowerCase().endsWith('.pdf')) {
        return sendJSON(res, 400, { ok: false, error: 'PDF 파일명이 필요합니다' });
      }
      const body = await readBody(req);
      if (!body.length) return sendJSON(res, 400, { ok: false, error: '빈 파일' });
      mkdirSync(PDFS_DIR, { recursive: true });
      writeFileSync(join(PDFS_DIR, name), body);
      return sendJSON(res, 200, { ok: true, name, sizeKB: Math.round(body.length / 1024) });
    }

    // 등록(빌드): POST /api/register {pdf, title, subject, examId?}
    if (p === '/api/register' && req.method === 'POST') {
      if (!existsSync(BUILD_SCRIPT)) return sendJSON(res, 500, { ok: false, error: '스킬(build.mjs)을 찾을 수 없습니다. ~/.claude/skills/exam-db-builder 확인' });
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const name = safeName(body.pdf);
      const pdfPath = join(PDFS_DIR, name);
      if (!existsSync(pdfPath)) return sendJSON(res, 404, { ok: false, error: 'PDF 없음: ' + name });
      const args = [pdfPath, '--out', ROOT];
      if (body.title) args.push('--title', String(body.title));
      if (body.subject) args.push('--subject', String(body.subject));
      if (body.examId) args.push('--exam-id', String(body.examId));
      // 검출 엔진 (auto|poppler|docling) — 스캔 PDF 는 docling 강제 가능
      if (['auto', 'poppler', 'docling'].includes(body.engine)) args.push('--engine', body.engine);
      const r = await runBuild(args);
      return sendJSON(res, 200, { ok: r.code === 0, ...r });
    }

    // 시험 삭제: DELETE /api/exam?id=<examId>  (db.json·이미지·풀이 폴더 + 인덱스 제거)
    if (p === '/api/exam' && req.method === 'DELETE') {
      const id = safeName(url.searchParams.get('id'));
      if (!id) return sendJSON(res, 400, { ok: false, error: 'examId 필요' });
      const examDir = join(DATA_DIR, 'exams', id);
      if (existsSync(examDir)) rmSync(examDir, { recursive: true, force: true });
      const index = readJSONSafe(EXAMS_JSON, { version: 1, exams: [] });
      index.exams = (index.exams || []).filter((e) => e.id !== id);
      writeFileSync(EXAMS_JSON, JSON.stringify(index, null, 2) + '\n');
      return sendJSON(res, 200, { ok: true, id });
    }

    if (p.startsWith('/api/')) return sendJSON(res, 404, { ok: false, error: 'unknown api' });

    // ---- 정적 ----
    return serveStatic(req, res, p + url.search);
  } catch (err) {
    return sendJSON(res, 500, { ok: false, error: String((err && err.message) || err) });
  }
});

server.listen(argPort, '127.0.0.1', () => {
  const skill = existsSync(BUILD_SCRIPT) ? '연결됨' : '⚠️ 미발견';
  console.log('');
  console.log('  EXAM Bank 로컬 어드민');
  console.log('  ─────────────────────────────────────');
  console.log(`  관리자  →  http://localhost:${argPort}/admin/`);
  console.log(`  뷰어    →  http://localhost:${argPort}/`);
  console.log(`  빌더 스킬: ${skill}  (${BUILD_SCRIPT})`);
  console.log('  Ctrl+C 로 종료');
  console.log('');
});

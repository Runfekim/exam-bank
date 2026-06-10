/* ============================================================
   EXAM Bank — 관리자(로컬) 로직 · Vanilla JS
   tools/admin-server.mjs 의 /api/* 를 호출한다.
   ============================================================ */
'use strict';

(function () {
  const $ = (s) => document.querySelector(s);

  const els = {
    skillWarn: $('#skill-warn'),
    sumExams: $('#sum-exams'),
    sumQuestions: $('#sum-questions'),
    sumPending: $('#sum-pending'),
    dropzone: $('#dropzone'),
    fileInput: $('#file-input'),
    pdfSelect: $('#pdf-select'),
    fTitle: $('#f-title'),
    fSubject: $('#f-subject'),
    fExamId: $('#f-examid'),
    btnRegister: $('#btn-register'),
    buildLog: $('#build-log'),
    btnRefresh: $('#btn-refresh'),
    examList: $('#exam-list'),
    examEmpty: $('#exam-empty'),
    unregCard: $('#unreg-card'),
    unregList: $('#unreg-list'),
    toast: $('#toast'),
  };

  let lastStatus = null;
  let toastTimer = null;

  // ---- helpers ----------------------------------------------------------
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
  }

  function showLog(text, kind) {
    els.buildLog.hidden = false;
    els.buildLog.textContent = text || '';
    els.buildLog.className = 'adm-log' + (kind ? ' ' + kind : '');
    els.buildLog.scrollTop = els.buildLog.scrollHeight;
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return { ok: res.ok, output: await res.text() };
  }

  // ---- status load + render --------------------------------------------
  async function loadStatus() {
    let st;
    try {
      st = await api('/api/status');
    } catch (e) {
      toast('서버 연결 실패 — node tools/admin-server.mjs 실행 중인지 확인');
      return;
    }
    lastStatus = st;
    els.skillWarn.hidden = !!st.skillFound;

    els.sumExams.textContent = st.totals.exams;
    els.sumQuestions.textContent = st.totals.questions;
    els.sumPending.textContent = st.totals.pending;

    renderPdfSelect(st.pdfs);
    renderExams(st.exams);
    renderUnregistered(st.pdfs);
  }

  function renderPdfSelect(pdfs) {
    const cur = els.pdfSelect.value;
    const opts = ['<option value="">— PDF 선택 —</option>'];
    for (const p of pdfs) {
      const tag = p.registered ? ' (등록됨)' : '';
      opts.push(`<option value="${esc(p.name)}">${esc(p.name)}${tag}</option>`);
    }
    els.pdfSelect.innerHTML = opts.join('');
    if (cur && pdfs.some((p) => p.name === cur)) els.pdfSelect.value = cur;
  }

  function renderExams(exams) {
    if (!exams.length) {
      els.examList.innerHTML = '';
      els.examEmpty.hidden = false;
      return;
    }
    els.examEmpty.hidden = true;
    els.examList.innerHTML = exams.map(examRow).join('');

    // bind actions (event delegation)
    els.examList.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const act = btn.getAttribute('data-act');
        const exam = exams.find((e) => e.id === id);
        if (act === 'copy') copyPrompt(exam);
        else if (act === 'delete') deleteExam(exam);
        else if (act === 'toggle') {
          const box = els.examList.querySelector(`[data-chips="${cssEsc(id)}"]`);
          if (box) box.hidden = !box.hidden;
        }
      });
    });
  }

  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  function examRow(e) {
    const pct = e.count ? Math.round((e.solved / e.count) * 100) : 0;
    const done = e.pending === 0 && e.count > 0;
    const label = done
      ? `완료 · ${e.count}문항 모두 풀이`
      : `${e.solved}/${e.count} 풀이 · 미풀이 ${e.pending}`;
    const chips = e.pendingIds.length
      ? `<div class="adm-chips" data-chips="${esc(e.id)}" hidden>` +
        e.pendingIds.map((id) => `<span class="adm-chip">${esc(id)}</span>`).join('') +
        `</div>`
      : '';
    const toggle = e.pendingIds.length
      ? `<button class="adm-pending-toggle" type="button" data-act="toggle" data-id="${esc(e.id)}">미풀이 ${e.pending}개 보기</button>`
      : '';

    return `
      <div class="adm-exam">
        <div class="adm-exam-top">
          <div>
            <div class="adm-exam-title">${esc(e.title)}</div>
            <div class="adm-exam-meta">${esc(e.subject || '')} · ${e.count}문항 · <code>${esc(e.id)}</code></div>
          </div>
          <div class="adm-exam-acts">
            <a class="adm-btn ghost sm" href="../#/exam/${encodeURIComponent(e.id)}" target="_blank" rel="noopener">뷰어</a>
            ${e.pending ? `<button class="adm-btn ghost sm" type="button" data-act="copy" data-id="${esc(e.id)}">Claude 풀이요청 복사</button>` : ''}
            <button class="adm-btn ghost sm danger" type="button" data-act="delete" data-id="${esc(e.id)}">삭제</button>
          </div>
        </div>
        <div class="adm-progress"><i style="width:${pct}%"></i></div>
        <div class="adm-prog-label ${done ? 'done' : ''}">${esc(label)}</div>
        ${toggle}
        ${chips}
      </div>`;
  }

  function renderUnregistered(pdfs) {
    const un = pdfs.filter((p) => !p.registered);
    if (!un.length) { els.unregCard.hidden = true; return; }
    els.unregCard.hidden = false;
    els.unregList.innerHTML = un.map((p) => `
      <div class="adm-unreg">
        <div>
          <div class="adm-unreg-name">${esc(p.name)}</div>
          <div class="adm-unreg-size">${p.sizeKB.toLocaleString()} KB</div>
        </div>
        <button class="adm-btn ghost sm" type="button" data-pick="${esc(p.name)}">등록폼에 넣기</button>
      </div>`).join('');
    els.unregList.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-pick');
        els.pdfSelect.value = name;
        if (!els.fTitle.value) els.fTitle.value = name.replace(/\.pdf$/i, '');
        els.fTitle.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  // ---- upload -----------------------------------------------------------
  async function uploadPdf(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) { toast('PDF 파일만 업로드할 수 있습니다'); return; }
    toast(`업로드 중: ${file.name}`);
    try {
      const r = await api('/api/pdf?name=' + encodeURIComponent(file.name), { method: 'PUT', body: file });
      if (!r.ok) { toast('업로드 실패: ' + (r.error || '')); return; }
      toast(`업로드 완료: ${r.name} (${r.sizeKB} KB)`);
      await loadStatus();
      els.pdfSelect.value = r.name;
      if (!els.fTitle.value) els.fTitle.value = r.name.replace(/\.pdf$/i, '');
    } catch (e) {
      toast('업로드 오류: ' + e.message);
    }
  }

  // ---- analyze / register ----------------------------------------------
  function selectedPdf() {
    const v = els.pdfSelect.value;
    if (!v) { toast('대상 PDF를 선택하세요'); return null; }
    return v;
  }

  async function register() {
    const pdf = selectedPdf(); if (!pdf) return;
    const title = els.fTitle.value.trim() || pdf.replace(/\.pdf$/i, '');
    const subject = els.fSubject.value.trim() || '수학';
    const examId = els.fExamId.value.trim();
    setBusy(true); showLog('등록(빌드) 중… 페이지 수에 따라 수십 초 걸릴 수 있습니다.');
    try {
      const r = await api('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf, title, subject, examId }),
      });
      showLog(r.output || r.error || '(출력 없음)', r.ok ? 'ok' : 'err');
      if (r.ok) { toast('등록 완료 — 풀이는 미풀이(pending) 상태입니다'); await loadStatus(); }
      else toast('등록 실패');
    } catch (e) { showLog('오류: ' + e.message, 'err'); }
    setBusy(false);
  }

  function setBusy(b) {
    els.btnRegister.disabled = b;
  }

  // ---- delete -----------------------------------------------------------
  async function deleteExam(e) {
    if (!e) return;
    if (!confirm(`"${e.title}" 시험을 삭제할까요?\n문항 DB·이미지·풀이가 모두 제거됩니다. (PDF는 유지)`)) return;
    try {
      const r = await api('/api/exam?id=' + encodeURIComponent(e.id), { method: 'DELETE' });
      if (r.ok) { toast('삭제됨: ' + e.id); await loadStatus(); }
      else toast('삭제 실패: ' + (r.error || ''));
    } catch (err) { toast('삭제 오류: ' + err.message); }
  }

  // ---- copy Claude prompt ----------------------------------------------
  function copyPrompt(e) {
    if (!e) return;
    const ids = e.pendingIds.join(', ');
    const text =
      `exam-db-builder 스킬로 "${e.title}" (examId: ${e.id}) 미풀이 문항을 풀어줘.\n` +
      `대상 ${e.pending}개: ${ids}\n` +
      `각 문항 이미지를 읽고 한국어+LaTeX 풀이(.md)를 작성한 뒤 apply-solution.mjs 로 적용해줘.`;
    const done = () => toast('풀이요청 프롬프트를 복사했습니다');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('복사 실패 — 수동 복사하세요'); }
    document.body.removeChild(ta);
  }

  // ---- events -----------------------------------------------------------
  function bind() {
    els.dropzone.addEventListener('click', () => els.fileInput.click());
    els.dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
    });
    els.fileInput.addEventListener('change', () => {
      if (els.fileInput.files[0]) uploadPdf(els.fileInput.files[0]);
      els.fileInput.value = '';
    });
    ['dragenter', 'dragover'].forEach((ev) =>
      els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) =>
      els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.remove('drag'); }));
    els.dropzone.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) uploadPdf(f);
    });

    els.pdfSelect.addEventListener('change', () => {
      const v = els.pdfSelect.value;
      if (v && !els.fTitle.value) els.fTitle.value = v.replace(/\.pdf$/i, '');
    });

    els.btnRegister.addEventListener('click', register);
    els.btnRefresh.addEventListener('click', loadStatus);
  }

  bind();
  loadStatus();
})();

# 📚 EXAM Bank

수능·모의고사 **문제지 PDF 한 개**를 넣으면 → 문항 단위로 분해하고(이미지·텍스트) → **풀이를 생성**해 → **문항 검색 DB**로 만들어, GitHub Pages에서 **단순 뷰어**로 보여주는 프로젝트.

- 🌐 공개 사이트: https://runfekim.github.io/exam-bank/
- 🗂 저장소(공개): `Runfekim/exam-bank` — **생성된 데이터 + 뷰어만** 올라감
- 🤖 데이터 빌더: **비공개 Claude 스킬** `exam-db-builder` (`~/.claude/skills/`, 저장소에 포함 안 됨)

## 구조 (역할 분리)

```
[ 문제 PDF ]
     │   (로컬에서 비공개 스킬 실행)
     ▼
exam-db-builder 스킬  ──►  data/db.json + data/images/*.png + data/solutions/*
     │                      (문항 분해 · 크롭 이미지 · 풀이 생성/인제스트 · 정답 추출)
     ▼  git push
[ GitHub Pages 단순 뷰어 ]  ──►  검색·정렬 가능한 문항 뷰어
```

- **빌더(비공개)**: 문제 PDF를 받아 데이터를 구성하는 모든 로직. 공개 저장소에 노출하지 않음.
- **웹(공개)**: `data/db.json` 만 읽어 렌더하는 정적 뷰어. 빌드 스텝 없음.

## 공개 저장소 구성

```
exam-bank/
├── index.html              # 뷰어: 시험지 목록 → 시험지 선택 → 문제·풀이 (2단)
├── assets/
│   ├── app.js              # exams.json·db.json 을 읽어 렌더
│   ├── style.css
│   └── tokens.css          # 디자인 토큰 (애플풍 Calm Mono · 화이트/블랙)
├── data/
│   ├── exams.json          # 시험지 목록 인덱스
│   └── exams/<시험지id>/
│       ├── db.json         # 그 시험지의 문항 DB
│       ├── images/<id>.png # 문항별 크롭 이미지
│       └── solutions/<id>.(md|pdf)  # 풀이(생성 마크다운 / 인제스트 PDF)
├── pdfs/<원본>.pdf          # 원본 문제 PDF
└── .github/workflows/deploy.yml  # 정적 배포만(빌드 없음)
```

`db.json` 스키마(v3)와 문항 id 규칙(`<그룹>-<번호>`)은 스킬 문서(`~/.claude/skills/exam-db-builder/SKILL.md`) 참고.

## 새 시험 추가 / 갱신 (스킬 사용)

문제 PDF를 준비한 뒤, 이 저장소 폴더에서 Claude Code에게 요청하면 `exam-db-builder` 스킬이 동작한다.

수동 실행 예:
```bash
# 1) 문항 매핑 확인(선택)
node ~/.claude/skills/exam-db-builder/scripts/build.mjs <문제.pdf> --analyze

# 2) DB·이미지 구성 (+ 기존 풀이 PDF가 있으면 인제스트)
node ~/.claude/skills/exam-db-builder/scripts/build.mjs <문제.pdf> \
  --out . [--solutions <풀이폴더>] --title "2026 수능 수학영역" --subject 수학

# 3) (풀이가 없는 문항은) Claude가 이미지를 보고 풀이 생성 → apply-solution.mjs 로 db 반영
# 4) git push → Pages 자동 배포
git add -A && git commit -m "update exam db" && git push
```

> 의존: `brew install poppler`, `pip3 install pillow` (스킬 실행 환경 = 로컬. 배포 워크플로는 정적 배포만 한다.)

### 스캔 PDF (텍스트 레이어 없음) — docling 엔진

텍스트 레이어가 없는 스캔 시험지는 poppler 로 문항 검출이 불가능하다. 이때 빌더는
[docling](https://github.com/docling-project/docling)(레이아웃 분석 + macOS Vision OCR)으로
자동 전환한다(`--engine auto` 기본). 로컬 1회 설치:

```bash
git clone --depth 1 https://github.com/docling-project/docling vendor/docling
/opt/homebrew/bin/python3.13 -m venv tools/.venv
tools/.venv/bin/pip install -e "./vendor/docling[convert-core,format-pdf,models-local,feat-ocr-mac,format-office,format-web,format-email,format-latex,cli]"
```

- `vendor/`, `tools/.venv/`, `*.docling.json`(추출 캐시)은 `.gitignore` — 로컬 전용.
- 어댑터는 `tools/docling_extract.py` (PDF → 페이지별 블록 JSON, pt·좌상단 원점).
- 첫 실행 시 레이아웃 모델을 자동 다운로드한다. 강제 지정: `--engine docling|poppler`.

## 로컬 미리보기
```bash
python3 -m http.server 8000   # http://localhost:8000
```
(`file://` 직접 열기는 fetch 보안정책상 db.json 을 못 읽으므로 로컬 서버 사용)

## 주의
- 풀이 중 **AI 생성** 항목은 정확성을 보장하지 않는다(가능하면 추출된 정답과 자동 대조하지만, 검토 권장).
- 데이터 구성 로직(스킬)은 비공개. 공개 저장소에는 생성 결과물만 둔다.

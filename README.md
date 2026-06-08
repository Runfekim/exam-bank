# 📚 EXAM Bank

문제집·풀이 **PDF를 GitHub 저장소에 보관**하고, **GitHub Pages** 에서 바로 조회·다운로드하는 심플한 정적 사이트입니다.

- **공개 사이트:** <https://runfekim.github.io/exam-bank/>
- **어드민(자료 관리):** <https://runfekim.github.io/exam-bank/admin/>
- **저장소:** `Runfekim/exam-bank` (브랜치 `main`)

특징

- 빌드 도구·프레임워크 없음 — 순수 HTML/CSS/Vanilla JS (의존성은 폰트 CDN 정도)
- PDF는 `pdfs/` 폴더에 그대로 저장 (저장소 = 파일 보관함)
- PDF를 넣고 push 하면 목록(`data/catalog.json`)이 GitHub Action 으로 **자동 생성·배포**됨
- PDF 미리보기는 브라우저 내장 뷰어(iframe) 사용

---

## 데이터 모델 — "세트(set)"

자료의 단위는 **세트**입니다. 한 세트 = `pdfs/` 아래의 폴더 하나이며, 그 안에 **문제지(problem)** 와 **풀이(solution)** 가 들어갑니다.

### 폴더 규칙

```
pdfs/<세트>/<문제지>.pdf          ← 세트 폴더 바로 아래의 PDF = 문제(problem)
pdfs/<세트>/<그룹>/<풀이>.pdf     ← 하위 폴더 안의 PDF = 풀이(solution), 폴더명 = 그룹(group)
```

- 세트 폴더 **바로 아래**에 둔 PDF는 모두 **문제지**로 잡힙니다. (보통 1개, 여러 개 가능)
- 세트 폴더 안의 **하위 폴더**는 풀이 **그룹**이 되고, 그 폴더 속 PDF가 그룹의 풀이 항목이 됩니다.
- 풀이 파일명이 `<그룹>_01` 처럼 그룹명으로 시작하면, 라벨에서 그룹 접두사를 떼고 `01` 만 표시합니다.
- 숫자는 자연 정렬됩니다 (`공통_2` < `공통_10`).

### 실제 예시 — `수능수학_2026_풀이`

```
pdfs/수능수학_2026_풀이/
├── 수학영역_문제지.pdf        → 문제지 (라벨 "수학영역 문제지")
├── 공통/
│   ├── 공통_01.pdf            → 풀이 · 그룹=공통 · 라벨 "01"
│   ├── 공통_02.pdf
│   └── … 공통_22.pdf          (22문항)
├── 미적분/
│   ├── 미적분_23.pdf          (23~30)
│   └── …
├── 확률과통계/
│   └── 확률과통계_23.pdf …     (23~30)
└── 기하/
    └── 기하_23.pdf …           (23~30)
```

위 폴더는 카탈로그에서 **문제지 1개 + 풀이 46개**(공통 22 + 미적분 8 + 확통 8 + 기하 8), 그룹 4개로 집계됩니다.

---

## 메타데이터 override — `data/meta.json`

사이트가 읽는 **source of truth 는 자동 생성된 `data/catalog.json`** 입니다. 직접 수정하지 마세요.
대신 `data/meta.json` 에서 **세트별로** 표시 정보를 덮어쓸 수 있습니다. 키는 세트 폴더명(=세트 id)입니다.

```json
{
  "수능수학_2026_풀이": {
    "title": "2026 수능 수학영역",
    "subject": "수학",
    "tags": ["수능", "2026", "수학"],
    "groupOrder": ["공통", "미적분", "확률과통계", "기하"],
    "hidden": false,
    "order": 0
  }
}
```

| 키 | 의미 | 미지정 시 기본값 |
|----|------|------------------|
| `title` | 카드에 표시할 제목 | 폴더명의 `_` 를 공백으로 바꾼 값 |
| `subject` | 과목 | `"기타"` |
| `tags` | 검색·표시용 태그 배열 | `[]` |
| `groupOrder` | 풀이 그룹 표시 순서 | 미지정 시 `공통` 먼저 → 한글 정렬 |
| `hidden` | `true` 면 사이트에서 숨김(빌드 제외) | `false` |
| `order` | 세트 정렬 순서(작을수록 앞) | `1000` (그다음 제목순) |

---

## 폴더 구조

```
EXAM_Bank/
├── index.html                  # 공개 페이지 (카드 목록 + PDF 뷰어)
├── admin/
│   └── index.html              # 어드민 (PAT 로 PDF/meta.json 직접 편집)
├── assets/
│   ├── style.css
│   └── app.js                  # catalog.json 을 읽어 화면을 그림
├── data/
│   ├── catalog.json            # ⚙️ 자동 생성 (직접 수정 금지)
│   └── meta.json               # 세트별 override (수정 가능)
├── pdfs/
│   └── <세트>/                  # 세트 = 폴더 하나
│       ├── <문제지>.pdf
│       └── <그룹>/<풀이>.pdf
├── scripts/
│   └── build-catalog.mjs       # pdfs/ 스캔 → catalog.json 생성
└── .github/workflows/deploy.yml  # push → 카탈로그 생성 → Pages 배포
```

> 경로 규칙: `catalog.json` 의 `pdf` 값은 **저장소 루트 기준 상대경로**(`pdfs/…`)입니다.
> 공개 페이지(루트의 `index.html`)는 그대로 쓰면 되고, 어드민은 하위 폴더라 **로컬 fetch 시에만 앞에 `../` 를 붙입니다.**
> 단, GitHub API 로 파일을 쓰고/지울 때 쓰는 `path` 는 항상 루트 기준(`pdfs/…`, `data/meta.json`)이며 `../` 를 붙이지 않습니다.

---

## 자료 추가하는 법

### 방법 A — 어드민 사용 (권장)

1. <https://runfekim.github.io/exam-bank/admin/> 접속
2. 발급한 GitHub Fine-grained PAT 입력 (아래 [PAT 발급](#어드민용-github-pat-발급) 참고)
3. 세트/문제지/풀이를 업로드하고, 필요하면 제목·태그·그룹 순서를 편집
4. 저장하면 어드민이 GitHub API 로 PDF·`meta.json` 을 커밋 → 1~2분 뒤 Action 이 `catalog.json` 을 다시 만들어 사이트에 반영

### 방법 B — 폴더에 직접 넣고 git push

1. [폴더 규칙](#폴더-규칙)대로 PDF를 배치합니다.
   ```
   pdfs/수능수학_2026_풀이/수학영역_문제지.pdf
   pdfs/수능수학_2026_풀이/공통/공통_01.pdf
   ```
2. (선택) `data/meta.json` 에 제목·태그·`groupOrder` 등을 추가합니다.
3. commit & push:
   ```bash
   git add pdfs data/meta.json
   git commit -m "add: 수능수학 2026"
   git push
   ```
4. GitHub Action 이 `catalog.json` 을 다시 생성하고 Pages 에 배포합니다(약 1~2분).

---

## 어드민용 GitHub PAT 발급

어드민은 브라우저에서 GitHub API 로 직접 파일을 쓰므로 **쓰기 권한 토큰**이 필요합니다. 권한을 이 저장소·콘텐츠로만 좁힌 **Fine-grained PAT** 를 쓰세요.

발급 경로: GitHub → 우상단 프로필 → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**

설정 값

- **Token name:** 알아보기 쉬운 이름 (예: `exam-bank-admin`)
- **Expiration:** 짧게 (예: 7일/30일). 만료되면 새로 발급하세요.
- **Repository access:** **Only select repositories** → `Runfekim/exam-bank` 만 선택
- **Permissions → Repository permissions → Contents:** **Read and write**
  (나머지 권한은 건드리지 않아도 됩니다)
- **Generate token** 후 표시되는 토큰 문자열을 복사해 어드민에 붙여넣습니다.

> ⚠️ 보안 주의
> - 토큰은 **비밀번호와 동급**입니다. 코드/커밋/스크린샷/채팅에 절대 남기지 마세요.
> - 토큰은 브라우저에만 입력하고, **공용 PC 에서는 사용 후 로그아웃·삭제**하세요.
> - 권한은 **이 저장소 + Contents 만**, 만료는 **짧게**. 의심되면 즉시 GitHub 에서 **Revoke** 하고 재발급하세요.

---

## 로컬에서 미리보기

`file://` 로 직접 열면 브라우저 보안정책 때문에 `catalog.json` 을 못 읽습니다. 간단한 로컬 서버로 여세요.

```bash
node scripts/build-catalog.mjs        # pdfs/ 스캔 → catalog.json 갱신
python3 -m http.server 8000           # http://localhost:8000 접속
```

어드민은 <http://localhost:8000/admin/> 로 열립니다.

---

## 배포 흐름 한눈에

```
PDF/meta.json 변경 → git push
        │
        ▼
[GitHub Action] scripts/build-catalog.mjs → data/catalog.json 재생성
        │
        ▼
GitHub Pages 배포 → index.html 이 catalog.json 으로 카드 목록 렌더 (약 1~2분)
```

- 처음 한 번: 저장소 → **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 설정.
- 공개 사이트의 단일 진실 공급원은 **생성된 `catalog.json`** 입니다. 어드민/사람은 **PDF 와 `meta.json` 만** 바꾸면 됩니다.

> PDF 뷰어는 브라우저 내장 PDF 렌더러(iframe)를 사용합니다. 일부 모바일 브라우저는 인라인 미리보기 대신 "새 탭에서 열기 / 다운로드"로 동작할 수 있습니다.

# 📚 EXAM Bank

문제집·풀이 **PDF를 GitHub 저장소에 보관**하고, **GitHub Pages(`https://<아이디>.github.io/<저장소>/`)** 에서 바로 조회·다운로드하는 심플한 정적 사이트입니다.

- 빌드 도구·프레임워크 없음 — 순수 HTML/CSS/JS
- PDF는 `pdfs/` 폴더에 그대로 저장 (저장소 = 파일 보관함)
- 폴더에 PDF만 넣고 push 하면 목록(`data/catalog.json`)이 **자동 생성**되고 사이트에 배포됨

---

## 폴더 구조

```
EXAM_Bank/
├── index.html               # 메인 페이지 (카드 목록 + PDF 뷰어)
├── assets/
│   ├── style.css
│   └── app.js               # catalog.json 을 읽어 화면을 그림
├── data/
│   └── catalog.json         # ⚙️ 자동 생성 (직접 수정 불필요)
├── pdfs/
│   ├── problems/<과목>/<제목>.pdf   # 문제 PDF
│   └── solutions/<과목>/<제목>.pdf  # 풀이 PDF (문제와 같은 경로 → 자동 연결)
├── scripts/
│   └── build-catalog.mjs    # pdfs/ 스캔 → catalog.json 생성
└── .github/workflows/deploy.yml   # push → 카탈로그 생성 → Pages 배포
```

## 자료 추가하는 법

1. 문제 PDF를 다음 위치에 넣습니다.
   ```
   pdfs/problems/수학/2024-모의고사-1회.pdf
   ```
2. (선택) 풀이 PDF를 **같은 상대경로**로 넣으면 자동으로 짝지어집니다.
   ```
   pdfs/solutions/수학/2024-모의고사-1회.pdf
   ```
3. commit & push → GitHub Action 이 목록을 다시 만들고 사이트에 반영합니다.

### 이름 규칙
| 항목 | 결정 방식 |
|------|-----------|
| **과목** | `problems` 바로 아래 첫 폴더 이름 (예: `수학`). 없으면 `기타` |
| **제목** | 파일명에서 `.pdf` 를 뗀 것. `-`, `_` 는 공백으로 표시 |
| **풀이 연결** | `problems/…` 와 **같은 상대경로**의 `solutions/…` 파일 |

> 처음에 들어있는 `샘플/기초-연습문제.pdf` 는 예시용입니다. 확인 후 `pdfs/problems/샘플`, `pdfs/solutions/샘플` 폴더를 삭제하세요.

## 처음 한 번: GitHub Pages 켜기

1. 이 폴더를 GitHub 저장소로 올립니다 (아래 "처음 올리기" 참고).
2. 저장소 → **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 설정합니다.
3. `main` 브랜치에 push 하면 자동 배포되고, 몇 분 뒤 `https://<아이디>.github.io/<저장소>/` 에서 열립니다.

## 처음 올리기

```bash
cd EXAM_Bank
git init
git add .
git commit -m "init: EXAM Bank"
git branch -M main
git remote add origin https://github.com/<아이디>/<저장소>.git
git push -u origin main
```

## 로컬에서 미리보기

`file://` 로 직접 열면 브라우저 보안정책 때문에 `catalog.json` 을 못 읽습니다. 간단한 로컬 서버로 여세요.

```bash
node scripts/build-catalog.mjs        # 카탈로그 갱신
python3 -m http.server 8000           # http://localhost:8000 접속
```

## 동작 방식 한눈에

```
PDF 추가 → git push → [GitHub Action] build-catalog.mjs → data/catalog.json
                                   └→ Pages 배포 → index.html 이 catalog.json 으로 카드 목록 렌더
```

PDF 뷰어는 브라우저 내장 PDF 렌더러(iframe)를 사용합니다. 일부 모바일 브라우저는 인라인 미리보기 대신 "새 탭에서 열기 / 다운로드"로 동작할 수 있습니다.

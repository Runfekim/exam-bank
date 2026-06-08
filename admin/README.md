# 🔐 EXAM Bank 어드민 — 빠른 사용법

PDF·메타데이터를 브라우저에서 직접 편집해 GitHub 에 커밋하는 관리자 페이지입니다.
공개 사이트와 데이터 모델·폴더 규칙은 [루트 README](../README.md)를 참고하세요.

- **어드민 URL:** <https://runfekim.github.io/exam-bank/admin/>
- **로컬:** <http://localhost:8000/admin/> (`python3 -m http.server 8000`)

---

## 1. 토큰 발급 (최초 1회 / 만료 시)

GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**

- **Repository access:** Only select repositories → `Runfekim/exam-bank`
- **Permissions → Repository permissions → Contents:** **Read and write**
- **Expiration:** 짧게 (예: 30일)

자세한 절차·보안 주의는 루트 README 의 [어드민용 GitHub PAT 발급](../README.md#어드민용-github-pat-발급) 참고.

> ⚠️ 토큰 = 비밀번호. 어디에도 남기지 말고, 공용 PC 에서는 사용 후 삭제. 의심되면 즉시 Revoke.

---

## 2. 사용 흐름

1. 어드민 접속 → 발급한 **PAT 붙여넣기**
2. **세트 추가**: 세트 폴더명(=id) 지정 → 문제지 PDF 업로드, 풀이 PDF 는 그룹별로 업로드
3. **메타 편집**: 제목(`title`)·과목(`subject`)·태그(`tags`)·그룹 순서(`groupOrder`)·숨김(`hidden`)·정렬(`order`)
4. **저장** → 어드민이 GitHub API 로 PDF·`data/meta.json` 을 커밋
5. **1~2분 대기** → GitHub Action 이 `data/catalog.json` 재생성 → 공개 사이트 반영

---

## 3. 폴더·경로 규칙 (핵심만)

```
pdfs/<세트>/<문제지>.pdf          ← 문제(problem)
pdfs/<세트>/<그룹>/<풀이>.pdf     ← 풀이(solution), 폴더명 = 그룹
```

- 로컬에서 카탈로그/PDF 를 **fetch** 할 때만 경로 앞에 `../` 를 붙입니다 (어드민이 하위 폴더라서).
- GitHub API 로 파일을 **쓰기/삭제**할 때 쓰는 `path` 는 **항상 루트 기준**(`pdfs/…`, `data/meta.json`) — `../` 금지.
- `data/catalog.json` 은 자동 생성물이므로 **직접 수정하지 않습니다.** 어드민은 PDF 와 `meta.json` 만 건드립니다.

---

## 4. 자주 막히는 곳

- **반영이 안 돼요** → Action 빌드(1~2분) 대기. 저장소 **Actions** 탭에서 성공 여부 확인.
- **403 / 권한 오류** → 토큰 만료 또는 Contents 권한 누락. 재발급 후 다시 입력.
- **목록에 안 보여요** → `meta.json` 의 `hidden: true` 또는 빈 세트(문제·풀이 0개)는 빌드에서 제외됩니다.

---
name: build-user-guide-site
description: >-
  OSS Hub 사용자 가이드 사이트(`website/`, Astro Starlight, GitHub Pages)를 처음부터 만들거나 화면이 바뀐 뒤 갱신하고 배포한다.
  「가이드 사이트」「사용자 가이드」「튜토리얼 문서」「GitHub Pages 가이드」「관리자·학생·교직원 사용법 문서」
  「가이드 업데이트·배포」「화면 캡처 다시」「스크린샷 갱신」「website/ 수정」 요청에 쓴다.
  격리 스택에서 합성 페르소나로 개인정보 없이 캡처하고(블러와 번호 붙은 빨간 박스),
  서브에이전트를 병렬로 돌려 캡처·집필·사실 확인·시각 검수·윤문을 하고,
  마일스톤마다 커밋·푸시·Pages 확인을 반복한다. 노션 핸드북은 build-oss-hub-handbook, PR은 submit-pr-evidence를 쓴다.
metadata:
  version: "1.0.1"
---

# 사용자 가이드 사이트 만들기와 갱신

학생, 관리자, 교직원, 로그인 전 방문자가 가이드만 보고 실제 서비스를 쓸 수 있게 하는 GitHub Pages 사이트를 만든다. 주소는 https://jnu-swcu.github.io/oss-hub/ 이다. 이 문서는 사용자가 정한 취향과 지금까지 굳은 절차를 담는다. 처음 만들 때도, 화면이 바뀐 뒤 고칠 때도 이 문서만으로 시작할 수 있어야 한다.

## Output contract

- `website/`(Astro 7, Starlight 0.42, base `/oss-hub`)가 빌드되고, 사이드바는 서비스 소개 → 시작하기 → 관리자 → 학생 → 교직원 → 자주 묻는 질문 순이다.
- 모든 작업 페이지는 목적 → 번호 단계와 이미지 → 성공 신호(`Success`) → 막혔을 때(`Recover`) 순서다.
- 이미지는 `website/src/assets/shots/<role>/<name>.webp`이고 개인정보는 블러, 설명은 번호 붙은 빨간 박스뿐이다.
- 본문에 이름, 아이디, 이메일, 학번, localhost, 시드, 합성 데이터, "버그"가 없다.
- 마일스톤마다 커밋하고 푸시했고 Pages 실행이 성공했다.

## 먼저 알아 둘 것

- 사용자 취향은 [`references/user-preferences.md`](references/user-preferences.md)에 원문과 함께 있다. 판단이 갈리면 그 문서가 먼저다.
- 오케스트레이터(이 세션)는 판단, 검수, 커밋만 한다. 나머지는 서브에이전트에게 병렬로 맡긴다.
- 캡처는 격리 스택과 합성 페르소나로만 한다. 로그인된 실제 브라우저(Aside 등)로 찍지 않는다.
- 비밀 값, 토큰, 세션 서명 키, 테스트 계정 비밀번호, 학번, 편집 전 캡처를 이 스킬이나 저장소에 두지 않는다. `.env` 값은 읽지도 복사하지도 않는다.

## 어디서 시작할지

| 상황 | 시작점 |
|---|---|
| `website/`가 없다 | 1단계부터. `references/site-scaffold.md` |
| 화면 몇 곳이 바뀌었다 | 2단계에서 바뀐 화면만 다시 찍고 3단계로 |
| 새 기능이 생겼다 | 사실표에 항목을 더하고 2단계부터 해당 역할만 |
| 문장만 고친다 | 3단계, 6단계. 이미지는 건드리지 않음 |

## 워크플로

각 단계의 상세와 서브에이전트 프롬프트 뼈대는 [`references/orchestration.md`](references/orchestration.md).

1. **골격.** [`references/site-scaffold.md`](references/site-scaffold.md). 스택, 설정, 컴포넌트 다섯 개(`Shot`, `Success`, `Recover`, `Verified`, `Steps`), 워크플로 두 개를 만든다. `Shot`은 없는 파일이면 빌드를 실패시킨다.
2. **캡처.** `capture-foundation`이 스택, 시드, 페르소나를 준비한 뒤 `capture-admin`, `capture-student`, `capture-staff`를 병렬로 돌린다. 기준은 [`references/capture-brief.md`](references/capture-brief.md), 스택은 [`references/stack.md`](references/stack.md), 데이터는 [`references/personas.md`](references/personas.md).
3. **집필.** `write-intro`와 `write-<role>` 세 개를 병렬로. 기준은 [`references/writer-brief.md`](references/writer-brief.md). 사실의 우선순위는 화면 > 사실표 > 코드 > 추측.
4. **사실 확인.** `factcheck-<role>`이 본문 주장을 화면과 코드에 대조해 불일치를 보고한다. 고치는 것은 집필 담당이다.
5. **시각 검수.** 배포된 사이트를 `scripts/visual-audit.mjs`로 1440/390, 라이트/다크에서 점검한다. [`references/qa-and-polish.md`](references/qa-and-polish.md).
6. **윤문.** 사실이 확정된 뒤 `polish-<role>`이 `humanize-korean` 스킬로 MDX를 깨지 않게 다듬는다.
7. **독자 시험.** Aside로 완성된 가이드를 처음 읽는 사람처럼 격리 스택에서 따라 해 본다. 같은 문서에 방법이 있다.
8. **릴리스.** 마일스톤마다 [`references/release-and-automation.md`](references/release-and-automation.md)의 한 바퀴를 돈다.

## 오케스트레이터가 직접 하는 검수

에이전트 보고는 부풀려질 수 있다. 커밋 전에 직접 본다.

1. 보고한 시각 이후에 파일이 만들어졌는지(`ls -lT`).
2. 장수가 맞는지.
3. `scripts/contact-sheet.py <이미지 폴더> <출력 접두사>`로 접촉 인쇄를 만들어 눈으로 본다. 안 가려진 개인정보, 잘린 글자, 로딩 상태, 빨간 박스 위치, 개발 배지.
4. 본문 금지어 grep, 빌드.

눈으로 보기 전에는 커밋하지 않는다.

## 릴리스 한 바퀴

`git add <명시한 경로>` → `bash skills/build-user-guide-site/scripts/release-check.sh` → 커밋(한국어 Conventional Commit, 본문 "-한다" 체, 마지막 줄은 세션의 attribution) → `scripts/check-public-safe.sh origin/main` → 푸시 → Pages 실행 확인 → 사용자에게 짧게 보고. 폴더 통째로 `git add` 하지 않는다(훅이 만든 `.omc/` 상태 파일이 `shots/` 아래에 생길 수 있다).

자동화는 `.github/workflows/website-pages.yml`(main 푸시 시 빌드와 배포)과 `website-check.yml`(PR은 빌드만)이다. 개발 중 임시로 연 `docs/user-guide-site` 브랜치 트리거와 `github-pages` 환경 브랜치 정책은 머지 전에 되돌린다. 최종 PR은 `submit-pr-evidence` 형식이며 티켓이 없으므로 본문 첫 줄이 `티켓 없음 — <이유>`다.

## 스크립트

| 파일 | 용도 |
|---|---|
| `scripts/capture-lib.mjs` | 합성 페르소나 세션, 블러, 빨간 박스, webp 저장. 박스 대상이 20px 미만이면 오류. `SESSION_SECRET` 환경 변수 필요 |
| `scripts/smoke.mjs` | `node smoke.mjs <login\|anon> <경로>...` 경로가 열리는지, 개인정보와 개발 배지가 새는지 |
| `scripts/visual-audit.mjs` | 배포 사이트를 네 조합으로 점검 |
| `scripts/contact-sheet.py` | 이미지 접촉 인쇄(오케스트레이터 검수용) |
| `scripts/release-check.sh` | mdx가 참조하는 이미지가 모두 git 인덱스에 있는지 |
| `scripts/psql.sh` | 격리 스택 DB에 psql |
| `scripts/stack.env.example` | 격리 스택 환경 변수 이름과 비밀이 아닌 값 |

스크립트는 비밀을 환경 변수로만 받고, 출력은 임시 폴더에 쓴다.

## 완료 체크리스트

- [ ] 사이드바 순서가 서비스 소개 → 시작하기 → 관리자 → 학생 → 교직원 → FAQ다.
- [ ] 모든 이미지를 접촉 인쇄로 눈으로 봤고, 개인정보는 블러, 설명은 번호 붙은 빨간 박스다.
- [ ] 본문 번호와 이미지의 박스 번호가 맞다.
- [ ] 라벨은 화면에 나온 그대로 백틱에 있다.
- [ ] 이름, 이메일, 학번, localhost, 시드, 합성, "버그"가 본문, alt, caption에 없다.
- [ ] `release-check.sh`와 `check-public-safe.sh`가 통과했다.
- [ ] 푸시했고 Pages 실행이 성공했으며 배포 주소에서 변경이 보인다.
- [ ] 제품 결함 후보는 본문이 아니라 별도 보고서에 있다.
- [ ] 스택을 껐다(`down -v`) 또는 남길 이유를 적었다.

## 하지 않는 것

- 로그인된 실제 브라우저로 캡처하지 않는다. Aside는 독자 시험과 배포 주소 확인에만 쓴다.
- 개인정보 외의 것을 가리지 않는다. 가리는 방법은 블러뿐이다.
- 눈으로 보지 않은 이미지를 커밋하지 않는다.
- `git add -A`, `git add .`, 폴더 통째 추가를 쓰지 않는다.
- 제품 결함을 본문에서 "버그"라고 부르지 않는다. 현재 동작과 우회 방법을 쓰고 결함은 따로 보고한다.
- `apps/`와 `scripts/`를 고치지 않는다. 코드에 주석을 새로 넣지 않는다.
- `build-oss-hub-handbook` 스킬을 고치지 않는다(겹치는 부분은 아래).
- 임시 브랜치 트리거를 머지 뒤까지 남기지 않는다.

## 요구사항

- Node 24 이상, pnpm, Docker(격리 스택), `gh`, Python 3 + Pillow(접촉 인쇄), Playwright와 `jose`(저장소의 `apps/frontend`, `apps/backend` 의존성에서 가져옴), 웹 사이트의 `sharp`.
- 환경 변수: `SESSION_SECRET`(스택을 띄운 값과 같게), 선택으로 `GUIDE_BASE_URL`, `GUIDE_SHOT_ROOT`, `GUIDE_PG_CONTAINER`, `GUIDE_SMOKE_DIR`.
- 이 저장소의 `scripts/check-public-safe.sh`, `skills/submit-pr-evidence`, `humanize-korean` 스킬.

## build-oss-hub-handbook과의 관계

둘 다 역할별 작업 목록, 증거 상태(`확인 완료/확인 필요/정책 확인 필요`), 안전한 스크린샷 원칙, 첫 사용자를 위한 글쓰기, 제품 문제 별도 보고, 품질 체크리스트를 공유한다. 이 스킬은 전달 대상이 GitHub Pages이고, 격리 스택과 합성 페르소나, 서브에이전트 병렬 작업, 자동 배포가 더해졌다. 집필 전에 핸드북의 `references/quality-checklist.md`를 읽는다.

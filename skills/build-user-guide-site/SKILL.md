---
name: build-user-guide-site
description: >-
  GitHub Pages로 배포하는 OSS Hub 사용자 가이드 사이트(`guide/`, Astro Starlight)를 처음부터 만들거나 화면이 바뀐 뒤 갱신하고 배포한다.
  「가이드 사이트」「GitHub Pages 가이드」「jnu-swcu.github.io/oss-hub」「guide/ 수정」
  「가이드 사이트 화면 캡처 다시」「가이드 스크린샷 갱신」「가이드 사이트 배포」 요청에 쓴다.
  격리 스택에서 예시 데이터로 캡처하고(가리지 않고 번호 붙은 빨간 박스로 설명),
  서브에이전트를 병렬로 돌려 캡처·집필·사실 확인·시각 검수·윤문을 하고,
  마일스톤마다 푸시와 Pages 확인을 반복한다.
  「가이드 전체 다시 만들어」「코드 바뀐 것만 가이드에 반영」「가이드 갱신」처럼 범위나 강도를 말할 때도 쓴다.
  대상은 `guide/`와 그 Pages 배포뿐이며, 다른 문서 채널과 제품 코드, 저장소 협업 절차는 다루지 않는다.
argument-hint: "[update|full] [low|mid|high]"
metadata:
  version: "1.4.0"
---

# 사용자 가이드 사이트 만들기와 갱신

학생, 관리자, 교직원, 로그인 전 방문자가 가이드만 보고 실제 서비스를 쓸 수 있게 하는 GitHub Pages 사이트를 만든다. 주소는 https://jnu-swcu.github.io/oss-hub/ 이다. 이 문서는 사용자가 정한 취향과 지금까지 굳은 절차를 담는다. 처음 만들 때도, 화면이 바뀐 뒤 고칠 때도 이 문서만으로 시작할 수 있어야 한다.

## Output contract

- `guide/`(Astro 7, Starlight 0.42, base `/oss-hub`)가 빌드되고, 사이드바는 서비스 소개 → 시작하기 → 관리자 → 학생 → 교직원 → 자주 묻는 질문 순이다.
- 모든 작업 페이지는 목적 → 번호 단계와 이미지 → 성공 신호(`Success`) → 막혔을 때(`Recover`) 순서다.
- 이미지는 `guide/src/assets/shots/<role>/<name>.webp`이고 사람은 모두 예시 데이터이며 가린 곳이 없고, 설명은 번호 붙은 빨간 박스뿐이다.
- 본문에 이름, 아이디, 이메일, 학번, localhost, 시드, 합성 데이터, "버그"가 없다.
- 마일스톤마다 커밋하고 푸시했고 Pages 실행이 성공했다.

## 먼저 알아 둘 것

- 사용자 취향은 [`references/user-preferences.md`](references/user-preferences.md)에 원문과 함께 있다. 판단이 갈리면 그 문서가 먼저다.
- 오케스트레이터(이 세션)는 판단, 검수, 커밋만 한다. 나머지는 서브에이전트에게 병렬로 맡긴다.
- 캡처는 격리 스택과 합성 페르소나로만 한다. 로그인된 실제 브라우저(Aside 등)로 찍지 않는다.
- 비밀 값, 토큰, 세션 서명 키, 테스트 계정 비밀번호, 학번, 편집 전 캡처를 이 스킬이나 저장소에 두지 않는다. `.env` 값은 읽지도 복사하지도 않는다.

## 어디서 시작할지

인자는 `[update|full] [low|mid|high]`이고 말로 해도 같다. 「바뀐 것만」은 `update`, 「전체 다시」는 `full`, 「문구만」은 `low`, 「꼼꼼히」는 `high`다. 생략하면 `update mid`이고, `guide/`가 없으면 인자와 상관없이 `full high`다. 강도는 작업 범위를 정할 뿐 세션의 effort 설정과는 별개다. 범위와 강도를 받았으면 비용이나 바뀐 코드가 없다는 이유로 다시 묻지 않는다. 사용자가 이미 고른 것이므로 비용은 보고에 한 줄로 적고 그대로 진행한다.

아래 번호는 워크플로 단계이고, 어느 칸이든 마지막은 8단계(릴리스)다.

| | `low` | `mid` | `high` |
|---|---|---|---|
| `update`: 기준 커밋 뒤 바뀐 곳만 | 3단계. 영향받은 쪽의 문구와 라벨만 코드에 맞춘다. 이미지와 서브에이전트 없음 | 2~4단계. 바뀐 화면만 다시 찍고 해당 역할만 집필과 사실 확인 | 2~7단계. 여기에 시각 검수, 윤문, 독자 시험 |
| `full`: 전체 | 모든 쪽의 라벨 대조와 문장 읽기. 재캡처 없음 | 2~4단계. 모든 화면을 다시 찍고 세 역할 모두 집필과 사실 확인 | 1~7단계 전부. `guide/`가 있으면 1단계는 점검만 |

`update`는 이렇게 시작한다.

1. `python3 skills/build-user-guide-site/scripts/guide-drift.py`로 `guide/src/site.ts`의 `checkedCommit` 뒤에 바뀐 코드 파일, 사라진 문구를 쓰는 쪽, 가이드에 없는 새 문구를 본다. 기준 커밋을 찾지 못하면 `full`로 알리고 넘어간다.
2. 스크립트는 문구만 잡는다. 레이아웃, 권한, 분기가 바뀐 파일은 diff를 읽어 어느 쪽에 닿는지 직접 판단한다. 대응표를 따로 두지 않는 이유는 표가 코드보다 먼저 낡기 때문이다.
3. 고칠 쪽과 다시 찍을 이미지 목록을 정한다. 바뀐 코드가 없으면 아무것도 고치지 않고 그대로 보고한다.

`checkedCommit`은 `mid` 이상을 끝낸 뒤에만, 비교한 `main`의 SHA로 올린다. `low`는 이미지를 보지 않으므로 기준을 올리면 다음 갱신에서 그 화면이 빠진다. 이미지에 옛 문구가 남았으면 그 목록을 보고한다. `guide/` 최신 커밋을 기준으로 삼지 않는 것도 같은 이유다. 문장만 고친 커밋이 검토하지 않은 코드 변경을 건너뛰게 만든다.

## 워크플로

각 단계의 상세와 서브에이전트 프롬프트 뼈대는 [`references/orchestration.md`](references/orchestration.md).

1. **골격.** [`references/site-scaffold.md`](references/site-scaffold.md). 스택, 설정, 컴포넌트 다섯 개(`Shot`, `Success`, `Recover`, `Verified`, `Steps`), 워크플로 두 개를 만든다. `Shot`은 없는 파일이면 빌드를 실패시킨다.
2. **캡처.** `capture-foundation`이 스택, 시드, 페르소나를 준비한 뒤 `capture-admin`, `capture-student`, `capture-staff`를 병렬로 돌린다. 기준은 [`references/capture-brief.md`](references/capture-brief.md), 스택은 [`references/stack.md`](references/stack.md), 데이터는 [`references/personas.md`](references/personas.md).
3. **집필.** `write-intro`와 `write-<role>` 세 개를 병렬로. 기준은 [`references/writer-brief.md`](references/writer-brief.md). 사실의 우선순위는 화면 > 사실표 > 코드 > 추측.
4. **사실 확인.** `factcheck-<role>`이 본문 주장을 화면과 코드에 대조해 불일치를 보고한다. 고치는 것은 집필 담당이다.
5. **시각 검수.** 배포된 사이트를 `scripts/visual-audit.mjs`로 점검한다. 조합과 항목은 [`references/audit-and-polish.md`](references/audit-and-polish.md)에 있다.
6. **윤문.** 사실이 확정된 뒤 `polish-<role>`이 `humanize-korean` 스킬로 MDX를 깨지 않게 다듬는다.
7. **독자 시험.** Aside로 완성된 가이드를 처음 읽는 사람처럼 격리 스택에서 따라 해 본다. 같은 문서에 방법이 있다.
8. **릴리스.** 마일스톤마다 [`references/release-and-automation.md`](references/release-and-automation.md)의 한 바퀴를 돈다.

## 오케스트레이터가 직접 하는 검수

에이전트 보고는 부풀려질 수 있다. 커밋 전에 [`references/orchestration.md`](references/orchestration.md)의 검수를 직접 한다. 눈으로 보기 전에는 커밋하지 않는다.

## 스크립트

`scripts/`는 이 스킬 폴더 안을 뜻한다. 저장소 루트의 `scripts/`에는 의존하지 않는다. 명령은 저장소 루트에서 `skills/build-user-guide-site/scripts/...`로 부른다.

| 파일 | 용도 |
|---|---|
| `scripts/capture-lib.mjs` | 합성 페르소나 세션, 빨간 박스, webp 저장. 박스 대상이 20px 미만이면 오류 |
| `scripts/margin-check.py` | 이미지 네 가장자리의 여백을 CSS px로 재서 내용이 붙거나 잘린 이미지를 찾는다 |
| `scripts/smoke.mjs` | `node smoke.mjs <login\|anon> <경로>...` 경로가 열리는지, 개인정보와 개발 배지가 새는지 |
| `scripts/visual-audit.mjs` | 배포 사이트를 네 조합으로 점검 |
| `scripts/contact-sheet.py` | 이미지 접촉 인쇄(오케스트레이터 검수용) |
| `scripts/release-check.sh` | mdx가 참조하는 이미지가 모두 git 인덱스에 있는지 |
| `scripts/guide-drift.py` | 기준 커밋 뒤 바뀐 코드와 영향받는 쪽, 코드에서 찾지 못한 라벨. `--base <sha>`, `--labels-only`(`full low`용), `--self-test` |
| `scripts/stack.env.example` | 격리 스택 환경 변수 이름과 비밀이 아닌 값 |

스크립트는 비밀을 환경 변수로만 받고, 출력은 임시 폴더에 쓴다.

## 완료 체크리스트

- [ ] 사이드바 순서가 서비스 소개 → 시작하기 → 관리자 → 학생 → 교직원 → FAQ다.
- [ ] 모든 이미지를 접촉 인쇄로 눈으로 봤고, 보이는 사람과 아이디는 모두 예시이며, 설명은 번호 붙은 빨간 박스다.
- [ ] 본문 번호와 이미지의 박스 번호가 맞다.
- [ ] 라벨은 화면에 나온 그대로 백틱에 있다.
- [ ] 이름, 이메일, 학번, localhost, 시드, 합성, "버그"가 본문, alt, caption에 없다.
- [ ] `release-check.sh`가 통과했다.
- [ ] 푸시했고 Pages 실행이 성공했으며 배포 주소에서 변경이 보인다.
- [ ] 제품 결함 후보는 본문에 쓰지 않고 사용자에게 따로 알렸다.
- [ ] 스택을 껐다(`down -v`) 또는 남길 이유를 적었다.
- [ ] `mid` 이상이면 `checkedCommit`을 비교한 `main` SHA로 올렸다. `low`면 그대로 두었다.

## 하지 않는 것

- 로그인된 실제 브라우저로 캡처하지 않는다. Aside는 독자 시험과 배포 주소 확인에만 쓴다.
- 화면을 가리지 않는다. 개인정보는 예시 데이터로 애초에 없앤다.
- 눈으로 보지 않은 이미지를 커밋하지 않는다.
- 제품 결함을 본문에서 "버그"라고 부르지 않는다. 현재 동작과 우회 방법을 쓰고 결함은 사용자에게 따로 알린다.
- `guide/`, 그 워크플로 두 개, 이 스킬 폴더 밖은 고치지 않는다. 코드에 주석을 새로 넣지 않는다.
- 임시 브랜치 트리거를 `main`에 남기지 않는다.

## 요구사항

- Node 24 이상, pnpm, Docker(격리 스택), `gh`, Python 3 + Pillow, numpy(접촉 인쇄, 여백 측정), Playwright와 `jose`(저장소의 `apps/frontend`, `apps/backend` 의존성에서 가져옴), 웹 사이트의 `sharp`.
- 환경 변수: `SESSION_SECRET`(스택을 띄운 값과 같게), 선택으로 `GUIDE_BASE_URL`, `GUIDE_SHOT_ROOT`, `GUIDE_PG_CONTAINER`, `GUIDE_SMOKE_DIR`.
- 윤문에 쓰는 `humanize-korean` 스킬.

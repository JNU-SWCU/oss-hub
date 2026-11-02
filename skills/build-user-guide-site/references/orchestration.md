# 오케스트레이션

오케스트레이터(메인 세션)는 판단, 검수, 커밋만 합니다. 캡처, 집필, 사실 확인, 시각 검수, 윤문은 서브에이전트가 합니다. 같은 단계 안의 일은 한 번에 여러 개를 병렬로 띄웁니다.

## 순서와 병렬 단위

| 단계 | 에이전트 | 병렬 | 입력 | 산출 |
|---|---|---|---|---|
| 0 | `site-scaffold` | 단독(새로 만들 때만) | `site-scaffold.md` | `guide/` 골격 |
| 1 | `capture-foundation` | 단독 | `stack.md`, `personas.md` | 스택, 시드, 준비 SQL, 페르소나 점검 |
| 2 | `capture-admin`, `capture-student`, `capture-staff` | 3개 병렬 | `capture-brief.md`, `facts-<role>.md` | webp 이미지, `manifest-<role>.md` |
| 3 | `write-intro`, `write-admin`, `write-student`, `write-staff` | 4개 병렬 | `writer-brief.md`, 매니페스트 | mdx |
| 4 | `factcheck-admin`, `factcheck-student`, (교직원) | 병렬 | 본문, 화면, 코드 | 불일치 목록 |
| 5 | `visual-audit` | 단독 | 배포된 사이트 | 네 조합 점검 결과 |
| 6 | `polish-admin`, `polish-student`, `polish-staff` | 병렬 | 본문 | 윤문된 mdx |
| 7 | Aside 독자 시험 | 단독 | 완성된 가이드 | 막힌 곳 목록 |

2단계가 끝나는 역할부터 3단계를 시작해도 됩니다. 순서가 중요한 것은 "이미지가 있어야 본문을 쓴다", "본문이 있어야 사실을 확인한다", "배포된 사이트가 있어야 시각 검수를 한다", "사실 확인이 끝나야 윤문한다" 네 가지입니다.

작업 폴더 `<G>`에는 사실표(`facts-<role>.md`), 매니페스트, 준비 SQL, 캡처 스크립트를 둡니다. 저장소에는 커밋하지 않습니다.

## 서브에이전트에게 줄 프롬프트의 뼈대

공통으로 넣습니다.

1. 목표 한 문장과 이 단계가 전체에서 맡는 부분.
2. `<ROOT>`(절대 경로)와 `<G>`, 읽을 파일 목록(`references/*-brief.md` 포함).
3. 쓸 수 있는 곳과 쓰면 안 되는 곳. 자기 역할 폴더와 `<G>` 밖은 수정하지 않고, 커밋과 푸시는 하지 않습니다.
4. 보고 형식(짧게). 장수, 못 한 것, 불일치, 결함 후보.
5. 이미 배제한 것(예: 이미 떠 있는 스택을 재시작하지 말 것).

역할별 보탤 말:

- 캡처: `capture-brief.md` 전체. 로그인한 실제 브라우저로 찍지 말 것.
- 집필: `writer-brief.md` 전체. 화면 > 사실표 > 코드 > 추측.
- 사실 확인: 본문의 모든 주장(라벨, 순서, 조건, 성공 신호)을 화면과 코드에 대조하고, 고치지 말고 불일치만 `Area / Observed / Expected / Evidence`로 보고. 본문 수정은 집필 담당에게 돌려줍니다.
- 시각 검수: `skills/build-user-guide-site/scripts/visual-audit.mjs`를 씁니다. 조합과 항목은 `audit-and-polish.md`에 있습니다.
- 윤문: `humanize-korean` 스킬 사용, MDX 안전 규칙 지키기. `audit-and-polish.md` 참고.

## 오케스트레이터가 직접 하는 검수

에이전트 보고는 부풀려질 수 있습니다. 보고를 믿고 커밋하지 마세요.

1. 파일 시각: `ls -lT guide/src/assets/shots/<role>/`로 보고된 시각 이후에 만들어졌는지 봅니다. 오래된 파일이면 이번에 찍은 것이 아닙니다.
2. 장수: 보고한 숫자와 실제 파일 수를 맞춰 봅니다.
3. 이미지: `python3 skills/build-user-guide-site/scripts/margin-check.py`로 여백을 재고, `python3 skills/build-user-guide-site/scripts/contact-sheet.py guide/src/assets/shots/<role> <scratch>/sheet-<role>`로 접촉 인쇄를 만들어 Read로 눈으로 봅니다. 확인할 것은 (a) 개인정보가 안 가려진 곳, (b) 잘린 글자, 가장자리에 걸린 줄, 로딩 상태, (c) 빨간 박스가 가리킨 곳, (d) 개발 배지와 토스트입니다. 의심스러운 한 장은 원본을 따로 엽니다.
4. 본문: 금지어(이름, 이메일, `localhost`, `seed`, "합성", "버그")를 grep합니다.
5. 빌드: `cd guide && pnpm exec astro build --outDir <scratch>`를 직접 돌립니다.

문제가 있으면 해당 에이전트에게 다시 돌려보냅니다(`SendMessage`). 직접 고치지 않습니다.

## 병렬 작업의 주의

- 같은 DB를 여러 캡처 에이전트가 씁니다. 확정 동작은 자기 전용 페르소나로만 하고 매니페스트에 기록합니다.
- 같은 `guide/`에서 여러 빌드가 돌면 캐시가 충돌합니다. 집필 에이전트는 각자 다른 `--outDir`을 쓰고, 실패하면 잠시 뒤 다시 돌립니다.
- 에이전트 각자는 자기 폴더만 씁니다. 캡처는 `shots/<role>/`, 집필은 `content/docs/<role>/`.
- 커밋할 때 폴더 통째로 `git add`하지 말고 파일 경로를 명시합니다.

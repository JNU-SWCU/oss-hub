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

## 서브에이전트가 값을 하는 곳

이 스킬에서 서브에이전트는 세 가지를 얻으려고 씁니다. 서로 독립인 일을 동시에 끝내고, 긴 출력을 메인 대화 밖에 두고, 쓴 사람과 다른 눈으로 검토하는 것입니다. 답이 더 똑똑해지지는 않고 토큰은 더 듭니다. 새로 띄운 에이전트는 맥락부터 다시 모으므로 오히려 느릴 수도 있습니다. 그래서 몇 파일만 보면 끝나는 확인은 오케스트레이터가 직접 하고, 같은 일을 여러 에이전트에 겹쳐 맡기지 않습니다.

**모델.** 단순 작업(링크 점검, 금지어 grep, `visual-audit` 실행과 결과 정리)만 `model: haiku`로 돌립니다. 캡처, 집필, 사실 확인, 윤문, 이미지 판정은 기본 모델을 씁니다. 공식 글이 haiku를 권한 것은 단순 작업까지이고, 사용자가 품질을 위해 토큰을 아끼지 말라고 했기 때문입니다.

## 서브에이전트에게 줄 프롬프트의 뼈대

서브에이전트는 이 대화를 보지 못합니다. 넘어가는 것은 프롬프트 한 덩이뿐이라 "앞서 말한 대로"가 통하지 않습니다. 필요한 경로와 결정 사항을 프롬프트에 모두 적습니다. 공통으로 넣습니다.

1. 목표 한 문장과 이 단계가 전체에서 맡는 부분.
2. `<ROOT>`(절대 경로)와 `<G>`, 읽을 파일 목록(`references/*-brief.md` 포함). 스크린샷과 임시 파일을 저장할 절대 경로도 정해 줍니다. 상대 경로로 두면 셸이 있던 폴더에 쌓입니다. 스킬 `scripts/` 폴더에 쌓인 적이 있습니다.
3. 쓸 수 있는 곳과 쓰면 안 되는 곳. 자기 역할 폴더와 `<G>` 밖은 수정하지 않고, 커밋과 푸시는 하지 않습니다. 서브에이전트를 또 띄우지 않습니다. 기본 설정은 3단계까지 허용하지만 그러면 비용과 보고 경로를 오케스트레이터가 보지 못합니다.
4. 보고 형식. 부모에게 돌아오는 것은 마지막 메시지뿐이므로 30줄 안에서 결론만 씁니다. 장수, 못 한 것, 불일치, 결함 후보를 적고, 상세는 `<G>` 파일에 쓴 뒤 경로를 줍니다. 끝났다는 말에는 근거를 붙입니다. 돌린 명령과 그 출력, 또는 만든 파일 경로입니다. 숫자는 제안이며, 긴 보고가 잘려 파일로 다시 받은 적이 있어서 정했습니다.
5. 이미 배제한 것(예: 이미 떠 있는 스택을 재시작하지 말 것).

역할별 보탤 말:

- 캡처: `capture-brief.md` 전체. 로그인한 실제 브라우저로 찍지 말 것.
- 집필: `writer-brief.md` 전체. 화면 > 사실표 > 코드 > 추측.
- 사실 확인: 본문의 모든 주장(라벨, 순서, 조건, 성공 신호)을 화면과 코드에 대조하고, 고치지 말고 불일치만 `Area / Observed / Expected / Evidence`로 보고. 독자가 틀리게 따라 할 만한 것만 올리고 문체와 취향은 뺍니다. 문제를 찾으라고 하면 검토자는 언제나 뭔가를 찾아 오기 때문입니다. 본문 수정은 집필 담당에게 돌려줍니다.
- 시각 검수: `skills/build-user-guide-site/scripts/visual-audit.mjs`를 씁니다. 조합과 항목은 `audit-and-polish.md`에 있습니다.
- 윤문: `humanize-korean` 스킬 사용, MDX 안전 규칙 지키기. `audit-and-polish.md` 참고.
- 독자 시험: 막힌 곳과 본 화면을 그대로 적게 하고, 고칠 방법은 제안으로만 받습니다. 원인은 오케스트레이터가 코드에서 확인합니다.

## 오케스트레이터가 직접 하는 검수

에이전트 보고는 부풀려질 수 있습니다. 보고를 믿고 커밋하지 마세요.

1. 파일 시각: `ls -lT guide/src/assets/shots/<role>/`로 보고된 시각 이후에 만들어졌는지 봅니다. 오래된 파일이면 이번에 찍은 것이 아닙니다.
2. 장수: 보고한 숫자와 실제 파일 수를 맞춰 봅니다.
3. 이미지: `python3 skills/build-user-guide-site/scripts/margin-check.py`로 여백을 재고, `python3 skills/build-user-guide-site/scripts/contact-sheet.py guide/src/assets/shots/<role> <scratch>/sheet-<role>`로 접촉 인쇄를 만들어 Read로 눈으로 봅니다. 확인할 것은 (a) 실제 사람처럼 보이는 값, (b) 잘린 글자, 가장자리에 걸린 줄, 로딩 상태, (c) 빨간 박스가 가리킨 곳, (d) 개발 배지와 토스트입니다. 의심스러운 한 장은 원본을 따로 엽니다.
4. 본문: 금지어(이름, 이메일, `localhost`, `seed`, "합성", "버그")를 grep합니다.
5. 빌드: `cd guide && pnpm exec astro build --outDir <scratch>`를 직접 돌립니다.

독자 시험과 사실 확인이 제안한 수정은 코드로 확인한 뒤 반영합니다. 화면에 영문 코드가 보인다는 지적의 진짜 원인이 제품이 아니라 준비 SQL의 잘못된 값이었던 적이 있습니다.

문제가 있으면 해당 에이전트에게 다시 돌려보냅니다(`SendMessage`). 직접 고치지 않습니다. 새로 띄우기보다 맥락을 가진 에이전트를 이어 쓰는 편이 빠르므로, 다시 찍기나 일이 중간에 끊긴 경우에도 먼저 `SendMessage`로 잇습니다. 내장 `Explore`와 `Plan`은 이어받을 수 없으니 이어 쓸 일에는 `general-purpose`를 씁니다.

## 병렬 작업의 주의

- 같은 DB를 여러 캡처 에이전트가 씁니다. 확정 동작은 자기 전용 페르소나로만 하고 매니페스트에 기록합니다.
- 같은 `guide/`에서 여러 빌드가 돌면 캐시가 충돌합니다. 집필 에이전트는 각자 다른 `--outDir`을 쓰고, 실패하면 잠시 뒤 다시 돌립니다.
- 에이전트 각자는 자기 폴더만 씁니다. 캡처는 `shots/<role>/`, 집필은 `content/docs/<role>/`.
- 커밋할 때 폴더 통째로 `git add`하지 말고 파일 경로를 명시합니다.
- 동시 실행 한도는 기본 20개이고, 넘으면 `Concurrent subagent limit reached`로 실패합니다. 한 단계에 3~4개면 충분합니다. 다중 에이전트는 채팅의 약 15배 토큰을 쓰므로 쪼갤 수 있다고 다 쪼개지 않습니다.
- 큰 결과는 대화로 가져오지 않습니다. 파일에 두고 스크립트로 걸러 요약만 봅니다. `pg_dump | grep`, `margin-check.py`가 이 방식입니다. 코드를 읽을 때도 경로와 줄 번호만 쥐고 필요한 부분을 엽니다.
- 이미지는 접촉 인쇄로 먼저 보고 의심스러운 장만 원본을 엽니다. 판정은 매니페스트에 적어 같은 이미지를 다시 열지 않게 합니다. 이미지 토큰을 다룬 공식 글은 찾지 못했고, 위 원칙에서 끌어낸 판단입니다.

## 근거

2026-11-03에 원문을 받아 인용을 확인했습니다. 글마다 조언이 다르면 현행 문서를 따릅니다.

- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices): 서브에이전트의 쓰임과 비용, haiku, 짧은 보고, 근거 요구, `Skip style`. 2025년 글과 달리 컨텍스트 절약만을 이유로 쓰라고 하지 않습니다.
- [Subagents in the SDK](https://code.claude.com/docs/en/agent-sdk/subagents): 프롬프트만 전달되는 점, 마지막 메시지만 돌아오는 점, 깊이와 동시 실행 한도, 이어받기.
- [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system): 약 15배 토큰, 결과를 외부에 두고 참조만 돌려주기, 3~5개 병렬.
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): 1,000~2,000토큰 요약, 필요할 때 불러오기.
- [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp): 큰 결과를 코드로 거르기.

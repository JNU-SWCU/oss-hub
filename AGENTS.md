# AGENTS.md — 에이전트·작업자 공용 규칙

이 문서는 oss-hub에서 작업하는 모든 AI 에이전트(Claude Code·Codex 등)와 사람의 공용 진입점이다.
본문은 라우팅·프로토콜·표만 담는다. 상세 규칙은 링크된 문서가 원본이다. 이 문서는 100줄을 넘기지 않는다.
문서는 한 문장을 한 줄에 쓴다 — 열 폭 하드랩은 렌더링 공백과 diff 노이즈를 만들므로 쓰지 않는다.
티켓 수행 워크플로의 원본은 `.claude/skills/tickets/SKILL.md`다 — Codex 등 다른 에이전트도 티켓 요청을 받으면 이 파일을 따른다.

## 1. 세션 부트스트랩 — 읽기 순서 고정

새 세션은 아래 순서로만 읽고 작업을 시작한다. 그 밖의 문서는 링크를 따라갈 때만 연다.

1. 이 파일 (AGENTS.md)
2. `docs/handoff/TEAM-STATE.md` — 팀 상태 스냅샷. as-of 시각 기준의 과거이며 실시간이 아니다.
3. 자기 기능의 exec-plan — `docs/exec-plan/active/<기능>.md`
4. 위 문서들이 링크한 규칙(`docs/rules/`)과 ADR(`docs/decisions/`)만 추가로 읽는다.
5. 착수 직전 `gh pr list --search "<기능>"` 1회 — 스냅샷 이후 열린 PR·Draft PR을 확인한다.
6. `bash scripts/setup-hooks.sh` 1회 — 저장소 Git 훅 활성화(멱등). "보존" 안내가 나오면 §7 참조.
7. 로컬 실행이 필요하면 `docs/rules/local-dev.md`의 순서를 따른다.

## 2. Canonical Store — 정보 종류별 원본 위치

한 사실은 한 원본에만 기록한다. repo에는 원본을 가리키는 링크·ID만 남기고 본문을 복사·인용하지 않는다.

| 정보 종류 | 원본(canonical) | repo에 남기는 것 |
| --- | --- | --- |
| 제품·기획 결정 | Notion Decision Log | Decision ID + 링크 |
| 기술·운영 결정 | `docs/decisions/` ADR | ADR 번호 |
| 구현 진행 상태 | GitHub Issue·Draft PR | Issue/PR 번호 |
| 시크릿(키·토큰) | secret store(배포 환경 변수) | 변수 이름만(`.env.example`) |
| 개인정보·실데이터 | 제한 저장소(repo 밖) | 없음 — 합성 fixture만 반입 |

## 3. 작성권 — 산출물마다 작성자 1인

기능 코드와 exec-plan은 owner 전속 경로다. owner가 아닌 사람·에이전트는 직접 수정하지 않고
Issue·PR 코멘트로 제안한다.
PM이 명시적으로 승인한 경우에 한해 비소유자가 owner 전속 경로를 수정할 수 있다.
이때 PR 본문에 승인 근거를 명시하고, owner가 사후 확인 코멘트로 추인한다.
2시간을 넘길 것으로 예상되거나 요구사항·설계·위험이 불확실한 작업은
초기에 Draft PR로 공개한다. 2시간 안에 구현·검증이 끝나는 작고 명확한 변경은 바로 Ready로 열 수 있다.
Draft는 사전 승인 게이트가 아니라 진행 상황과 위험을 일찍 공유하는 수단이다.
PR을 제출하기 전 `docs/handoff/TEAM-STATE.md`의 해당 기능 행을 이 브랜치에서 갱신한다 — pre-push 훅이 검사하며, 우회는 `TEAM_STATE_SKIP=1` + PR 본문에 사유 명시다(`docs/handoff/team-state-drift-check.md`).

| 기능 | owner | exec-plan 경로 | 코드 경로 |
| --- | --- | --- | --- |
| (기능 1 — 지정 예정) | @GoBeromsu | `docs/exec-plan/active/<기능1>.md` | (지정 예정) |
| GitHub OAuth 로그인 | @Lumiere001 | `docs/exec-plan/active/github-oauth-login.md` | `apps/backend/src/auth`, `apps/frontend/src/features/auth` |
| GitHub 활동 수집기 | @Lumiere001 | `docs/exec-plan/active/github-collector.md` | `apps/backend/src/collection` |
| (기능 3 — 지정 예정) | @<designer-1> | `docs/exec-plan/active/<기능3>.md` | (지정 예정) |
| (기능 4 — 지정 예정) | @<designer-2> | `docs/exec-plan/active/<기능4>.md` | (지정 예정) |

공용 경로(공유 lib·설정·CI)는 독립 소형 PR로만 수정하고, 착수 전 Issue로 선점을 선언한다. PR 범위·분해 기준은 `docs/rules/pr-scope.md`가 원본이다.
DB 마이그레이션은 직렬로만 진행한다. 동시 마이그레이션 PR을 만들지 않는다.

### 리뷰 결과 운용 — ADR-005 waypoint

권한 경계와 병합 조건은 [ADR-005](docs/decisions/ADR-005-agent-driven-review-cycle.md)가 원본이다.
전남의 독립 리뷰는 적용되는 `AGENTS.md`·팀 컨벤션 준수, 중복 구현, 기존 기능의 불필요한 재구현, correctness·security·명시적 계약 위반을 검증한다.
리뷰 결과는 `blocker`, `fix-now`, `follow-up`, `reject`로 분류하며 정확한 의미는 ADR-005를 따른다.
일반 PR은 전남이 exact head에서 코드·계약, Ponytail, 실제 UI/API QA, 저장소 검증과 required CI를 통과시켜 `MERGE_READY`를 기록하면 사람 상호 리뷰 없이 병합할 수 있다.
권한·개인정보·DB migration·비가역 데이터, CI·배포·rollback·CODEOWNERS·보안 정책, 외부 권한 연동과 횡단 계약 변경은 high risk다.
high risk는 경로가 아닌 변경 효과로 판정하고 CODEOWNERS는 후보 신호로만 쓰며, 분류가 모호하면 high risk로 처리한다.
high risk PR은 `MERGE_READY` 외에 PM인 @GoBeromsu와 Tech Lead인 @Lumiere001의 같은 head SHA manual accept가 모두 필요하다.
production release 배포도 두 사람의 release SHA manual accept 뒤에만 시작하며, Jenkins 실패·복구 동작은 ADR-002의 현재 계약을 따른다.

## 4. 에이전트 금지 목록

에이전트는 아래 작업을 지시받아도 수행하지 않고 owner 또는 @Lumiere001에게 되돌린다.

- 공개 endpoint 응답과 private 테이블을 join하는 쿼리·API 작성
- 학생(사용자) 토큰으로 쓰기 API 호출
- lockfile(`pnpm-lock.yaml`) 수동 병합 — 충돌 시 merge 후 재생성만 허용
- 시크릿·실명·개인 머신 경로(`/Users/` 등)를 코드·문서·커밋 메시지·PR 본문에 포함
- 개인정보 원본·실데이터(마스킹본 포함)를 repo 또는 외부 LLM에 반입

## 5. 커밋 규칙 — 아토믹 + Conventional Commits

형식은 [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)을 따른다. 아래는 이 repo의 로컬 규칙이다.

- 아토믹: 한 커밋 = 하나의 논리적 변경. 요약에 "및·그리고"가 들어가면 쪼개라는 신호다. 중간 상태로 빌드가 깨지는 커밋을 만들지 않는다.
- 요약은 한국어 한 줄. type은 `feat`(기능) `fix`(버그) `docs`(문서) `refactor`(동작 불변 정리) `test` `chore`(설정·잡무) `ci`만 쓴다.
- 본문은 요약으로 "왜"가 부족할 때만 1~3줄. PR 본문과 중복 서술하지 않는다.
- 에이전트가 만든 커밋도 동일 규칙이다 — 여러 파일을 한 번에 고쳤어도 논리 단위로 나눠 커밋한다.

## 6. Public-safe 경계

이 repo는 PUBLIC이다. 코드뿐 아니라 Issue·PR 본문·CI 로그·스크린샷 전부가 공개 범위다.
사람 표기는 GitHub @handle만 사용한다. 공개 가능 여부의 판단 기준과 deny-list는
`docs/rules/security.md`가 원본이다.

## 7. 브랜치 뒷정리

목적: 에이전트가 main 동기화 직후, merge 완료된 로컬 브랜치를 자동 정리한다.
원격 브랜치는 repo 설정 `delete_branch_on_merge`가 merge 시점에 자동 삭제한다.

- 활성화: `bash scripts/setup-hooks.sh` (§1 부트스트랩 6번, 멱등) — `pnpm install`은 Git 설정을 건드리지 않는다.
- 동작: `.githooks/post-merge`가 main에서 merge 기반 pull로 실제 FF/merge가 완료될 때
  `scripts/tidy-branches.sh`를 실행한다. origin/main 이력에 포함된 gone 브랜치만 `git branch -d`로
  삭제하고, 그 외에는 보류 안내만 한다. rebase 기반 pull·변경 없는 pull에서는 발화하지 않는다.
- 다른 `core.hooksPath`를 쓰고 있으면 그 설정을 보존하고 이 훅은 비활성이다 — 이 경우
  `scripts/tidy-branches.sh`를 수동 또는 자기 훅·주기 작업에서 직접 실행한다. 기존 설정 확인: `git config --show-origin --get core.hooksPath`

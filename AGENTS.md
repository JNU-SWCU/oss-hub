# AGENTS.md — 에이전트·작업자 공용 규칙

이 문서는 oss-hub에서 작업하는 모든 AI 에이전트(Claude Code·Codex 등)와 사람의 공용 진입점이다.
본문은 라우팅·프로토콜·표만 담고 상세 규칙은 링크된 문서가 원본이며 이 문서는 100줄을 넘기지 않는다.
문서는 한 문장을 한 줄에 쓴다 — 열 폭 하드랩은 렌더링 공백과 diff 노이즈를 만들므로 쓰지 않는다.
티켓 수행 워크플로의 원본은 `.claude/skills/tickets/SKILL.md`다 — Codex 등 다른 에이전트도 티켓 요청을 받으면 이 파일을 따른다.
저장소 검사·운영 보조 스크립트는 [scripts/AGENTS.md](scripts/AGENTS.md), claude.ai/design 번들 도구는 [.design-sync/AGENTS.md](.design-sync/AGENTS.md)가 원본이며 `deploy/**`와 `scripts/check-jenkinsfile*.sh`는 ADR-005의 배포 계약 경로다.

## 1. 세션 부트스트랩 — 읽기 순서 고정

새 세션은 아래 순서로만 읽고 작업을 시작하며 그 밖의 문서는 링크를 따라갈 때만 연다.

1. 이 파일 (AGENTS.md)
2. `docs/handoff/TEAM-STATE.md` — 팀 상태 스냅샷이며 as-of 시각 기준의 과거이고 실시간이 아니다.
3. 자기 기능의 exec-plan — `docs/exec-plan/active/<기능>.md`
4. 위 문서들이 링크한 규칙(`docs/rules/`)과 ADR(`docs/decisions/`)만 추가로 읽는다.
5. 착수 직전 `gh pr list --search "<기능>"` 1회 — 스냅샷 이후 열린 PR을 확인한다.
6. `bash scripts/setup-hooks.sh` 1회 — 저장소 Git 훅 활성화(멱등). "보존" 안내가 나오면 §7 참조.
7. 로컬 실행이 필요하면 `docs/rules/local-dev.md`를 따른다 — 호스트 hot reload(`pnpm dev`)와 컨테이너 통합 검증(`pnpm local:up`)의 선택 기준이 거기 있다.

## 2. Canonical Store — 정보 종류별 원본 위치

한 사실은 한 원본에만 기록하며 repo에는 원본을 가리키는 링크·ID만 남기고 본문을 복사·인용하지 않는다.

| 정보 종류 | 원본(canonical) | repo에 남기는 것 |
| --- | --- | --- |
| 제품·기획 결정 | Notion Decision Log | Decision ID + 링크 |
| 기술·운영 결정 | `docs/decisions/` ADR | ADR 번호 |
| 구현 진행 상태 | GitHub Issue·PR | Issue/PR 번호 |
| 시크릿(키·토큰) | secret store(배포 환경 변수) | 변수 이름만(`.env.example`) |
| 개인정보·실데이터 | 제한 저장소(repo 밖) | 없음 — 합성 fixture만 반입 |
실값은 Notion "Credentials" 페이지가 원본이며 배포 설정 변경 시의 갱신 요건은 `docs/rules/security.md`가 원본이다.

## 3. 작성권 — 산출물마다 작성자 1인

기능 코드와 exec-plan은 owner 전속 경로이며 owner가 아닌 사람·에이전트는 직접 수정하지 않고 Issue·PR 코멘트로 제안한다.
@GoBeromsu와 @Lumiere001은 owner 표와 무관하게 저장소 전체 경로를 사전 허락 없이 수정하는 free-role 예외를 가진다(원본: ADR-005).
PR 본문에 대상 기능과 owner를 명시해 owner를 리뷰어로 지정하고, 착수 전 Issue로 선점을 선언하며, owner의 사후 확인 코멘트는 병합 조건이 아니다.
PR은 항상 Ready로 연다 — Draft 단계를 쓰지 않는다.
Draft는 GitHub에서 병합이 원천 차단되고(`--admin`으로도 우회되지 않는다) required check가 전부 green이어도 아무 신호가 없어 완성된 변경이 조용히 방치되는 주차장으로 쓰였다.
진행 중 공유가 필요하면 Draft가 아니라 Issue 코멘트나 PR 본문 갱신으로 알린다.
PR을 제출하기 전 `docs/handoff/TEAM-STATE.md`의 해당 기능 행을 이 브랜치에서 갱신한다 — pre-push 훅이 검사하며, 우회는 `TEAM_STATE_SKIP=1` + PR 본문에 사유 명시다(`docs/handoff/team-state-drift-check.md`).

| 기능 | owner | exec-plan 경로 | 코드 경로 |
| --- | --- | --- | --- |
| (기능 1 — 지정 예정) | @GoBeromsu | `docs/exec-plan/active/<기능1>.md` | (지정 예정) |
| GitHub OAuth 로그인 | @Lumiere001 | `docs/exec-plan/archive/github-oauth-login.md`(완료, archive) | `apps/backend/src/auth`, `apps/frontend/src/features/auth` |
| GitHub 활동 수집기 | @Lumiere001 | `docs/exec-plan/archive/github-collector.md`(완료, archive) — 현재 아키텍처는 [ADR-006](docs/decisions/ADR-006-github-app-integration.md)이 원본 | `apps/backend/src/collection` |
| (기능 3 — 지정 예정) | @<designer-1> | `docs/exec-plan/active/<기능3>.md` | (지정 예정) |
| (기능 4 — 지정 예정) | @<designer-2> | `docs/exec-plan/active/<기능4>.md` | (지정 예정) |

공용 경로(공유 lib·설정·CI)는 독립 소형 PR로만 수정하고 착수 전 Issue로 선점을 선언하며 PR 범위·분해 기준은 `docs/rules/pr-scope.md`가 원본이다.
DB 마이그레이션은 직렬로만 진행하며 동시 마이그레이션 PR을 만들지 않는다.

### 리뷰 결과 운용 — ADR-005 waypoint

권한 경계와 병합 조건은 [ADR-005](docs/decisions/ADR-005-agent-driven-review-cycle.md)가 원본이다.
전남의 독립 리뷰는 적용되는 `AGENTS.md`·팀 컨벤션 준수, 중복 구현, 기존 기능의 불필요한 재구현, correctness·security·명시적 계약 위반을 검증한다.
리뷰 결과는 `blocker`, `fix-now`, `follow-up`, `reject`로 분류하며 정확한 의미는 ADR-005를 따른다.
일반 PR은 전남이 exact head·base에서 코드·계약, Ponytail, 실제 UI/API QA, 저장소 검증과 required CI를 통과시켜 `MERGE_READY`를 기록하면 사람 상호 리뷰 없이 병합할 수 있으며, 동작 변경의 직접 QA가 막히면 미검증으로 처리해 병합하지 않는다.
전남의 `MERGE_READY`는 @GoBeromsu, @Lumiere001 또는 리뷰 증거 전용 계정 @Lumeire002가 기록할 수 있지만, @Lumeire002에는 병합 권한을 위임하지 않는다.
high risk의 전체 분류표와 예외는 ADR-005만을 원본으로 사용한다.
accept 코멘트(`PM_ACCEPT`·`TECH_LEAD_ACCEPT`·`RISK_ACCEPT`) 병합 게이트는 폐지됐다 — high risk PR과 배포 계약 경로 변경 PR도 `MERGE_READY` 확인만으로 병합 절차를 진행하며, 실제 병합 권한 제한은 GitHub 저장소 설정(branch protection 등)이 원본이다.
production release 배포의 인가·트리거·실행 검증과 실패·복구 동작은 ADR-002가 원본이며, 별도의 release accept 절차는 두지 않는다.

## 4. 에이전트 금지 목록과 공개 strict-read 경계

에이전트는 아래 작업을 지시받아도 수행하지 않고 owner 또는 @Lumiere001에게 되돌린다.

- 공개 endpoint가 private 테이블을 읽는 것은 owner-approved dedicated public query repository 안에서만 허용한다.
- 해당 repository는 명시적 `select`와 public DTO allowlist만 사용하고, service allowlist와 동일한 private/nonexistent 404를 적용하며 selector/integration review evidence를 남긴다.
- controller와 일반 service의 Prisma 직접 접근, 임의 private join, wildcard `include`, redact-later 설계와 forbidden field fetch는 계속 금지한다.
- 학생(사용자) 토큰으로 쓰기 API 호출
- lockfile(`pnpm-lock.yaml`) 수동 병합 — 충돌 시 merge 후 재생성만 허용
- 시크릿·실명·개인 머신 경로(`/Users/` 등)를 코드·문서·커밋 메시지·PR 본문에 포함
- 개인정보 원본·실데이터(마스킹본 포함)를 repo 또는 외부 LLM에 반입

## 5. 커밋 규칙 — 아토믹 + Conventional Commits

형식은 [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)을 따르며 아래는 이 repo의 로컬 규칙이다.

- 아토믹: 한 커밋 = 하나의 논리적 변경이며 요약에 "및·그리고"가 들어가면 쪼개라는 신호이고 중간 상태로 빌드가 깨지는 커밋을 만들지 않는다.
- 요약은 한국어 한 줄이며 type은 `feat`(기능) `fix`(버그) `docs`(문서) `refactor`(동작 불변 정리) `style`(공백·줄바꿈 등 표기만) `test` `chore`(설정·잡무) `ci`만 쓴다. `style`과 `refactor`는 갈린다 — 코드가 하는 일도 구조도 그대로고 표기만 바뀌면 `style`, 하는 일은 같은데 구조를 손봤으면 `refactor`다.
- 이 목록은 `commitlint.config.cjs`의 `type-enum`과 **한 벌이다.** 한쪽만 고치면 문서와 검사가 갈라진다.
- `.githooks/commit-msg`가 커밋하는 순간 이 규칙을 검사한다 — CI에서만 걸리면 이미 이력에 박힌 뒤라 고치려면 역사를 다시 써야 하고, 그 커밋을 다른 브랜치가 가리키면 강제 푸시가 남의 작업을 무너뜨린다. 훅을 켜려면 §7과 같은 `git config core.hooksPath .githooks` 하나면 된다.
- 본문은 요약으로 "왜"가 부족할 때만 1~3줄로 쓰며 PR 본문과 중복 서술하지 않는다.
- 에이전트가 만든 커밋도 동일 규칙이다 — 여러 파일을 한 번에 고쳤어도 논리 단위로 나눠 커밋한다.

## 6. Public-safe 경계

이 repo는 PUBLIC이며 코드뿐 아니라 Issue·PR 본문·CI 로그·스크린샷 전부가 공개 범위다.
사람 표기는 GitHub @handle만 사용하며 공개 가능 여부의 판단 기준과 deny-list는 `docs/rules/security.md`가 원본이다.

## 7. 브랜치 뒷정리

목적: 에이전트가 main 동기화 직후, merge 완료된 로컬 브랜치를 자동 정리한다.
원격 브랜치는 repo 설정 `delete_branch_on_merge`가 merge 시점에 자동 삭제한다.

- 활성화: `bash scripts/setup-hooks.sh` (§1 부트스트랩 6번, 멱등) — `pnpm install`은 Git 설정을 건드리지 않는다.
- 동작: `.githooks/post-merge`가 main에서 merge 기반 pull로 실제 FF/merge가 완료될 때 `scripts/tidy-branches.sh`를 실행하고 origin/main 이력에 포함된 gone 브랜치만 `git branch -d`로 삭제하며 그 외에는 보류 안내만 하고 rebase 기반 pull·변경 없는 pull에서는 발화하지 않는다.
- 다른 `core.hooksPath`를 쓰고 있으면 그 설정을 보존하고 이 훅은 비활성으로 두며 이 경우 `scripts/tidy-branches.sh`를 수동 또는 자기 훅·주기 작업에서 직접 실행하고 기존 설정은 `git config --show-origin --get core.hooksPath`로 확인한다.

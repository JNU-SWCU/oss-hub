# 에이전트 스킬 라우팅

이 문서는 oss-hub에서 어떤 작업에 어떤 스킬을 쓰는지 정하는 원본이다.
스킬은 절차를 담고 이 저장소의 규칙은 담지 않는다 — 규칙의 원본은 항상 [AGENTS.md](../../AGENTS.md)와 그 링크 문서다.

## 표 하나가 원본이다

| 작업 표면 | 쓰는 스킬 | 스킬 위치 | 이 repo에서 함께 지키는 것 |
| --- | --- | --- | --- |
| QA 티켓 작성·발행·수행 | `manage-qa-tickets` | repo `skills/manage-qa-tickets` | 그 스킬이 자기 절차의 원본이다 |
| 릴리스 후보 QA | `run-release-qa` | repo `.claude/skills/run-release-qa` | 출시 판정은 그 스킬이 원본이다 |
| frontend 코드 구현 | craft `frontend` | 외부 플러그인 | [frontend.md](frontend.md)가 feature 폴더 경계·단일 API 클라이언트의 원본 |
| backend 코드 구현 | craft `backend` | 외부 플러그인 | [ADR-003](../decisions/ADR-003-backend-architecture.md)과 `apps/backend/src/AGENTS.md`가 계층 경계의 원본 |
| 화면 디자인 판단·토큰 | craft `design` | 외부 플러그인 | [docs/design.md](../design.md)가 색·타이포·토큰 3-tier·컴포넌트 소유권의 원본 |
| 테스트 스위트 구조 | craft `testing` | 외부 플러그인 | [ci-path-verification.md](ci-path-verification.md)가 경로별 검증 명령의 원본 |
| 스키마·쿼리·마이그레이션 판단 | craft `db` | 외부 플러그인 | [data-modeling.md](data-modeling.md)가 테이블 추가·명명·projection의 원본이고 마이그레이션 직렬 규칙은 AGENTS.md §3이다 |
| 공개 HTTP API 계약 | craft `api` | 외부 플러그인 | [ADR-004](../decisions/ADR-004-REST-API-규격.md)가 REST 규격, [ADR-008](../decisions/ADR-008-api-response-field-ownership.md)이 응답 필드 소유권의 원본 |
| CI·배포 파이프라인 변경 | craft `cicd` | 외부 플러그인 | [ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)가 배포 계약, [ci-path-verification.md](ci-path-verification.md)가 경로별 검증의 원본이며 `deploy/**`·`scripts/check-jenkinsfile*.sh`는 ADR-005 배포 계약 경로다 |
| 실행 중인 화면 조작·증거 수집 | craft `browser` | 외부 플러그인 | 티켓 캡처의 요소 단위 절차는 [qa-dom-capture](../../skills/manage-qa-tickets/agents/qa-dom-capture.md)가 원본이다 |
| TypeScript 구현 공통 규율 | craft `programming` | 외부 플러그인 | 화면·API 경계는 위 두 행이 원본이고 lint 계약은 `apps/*/eslint.config.mjs`와 `apps/backend/eslint-rules/`가 강제한다 |
| 동작 불변 정리 | craft `refactor` | 외부 플러그인 | 계층 경계는 [ADR-003](../decisions/ADR-003-backend-architecture.md)과 `apps/backend/eslint-rules/`가 강제한다 |
| 실패 원인 진단 | craft `debug` | 외부 플러그인 | 수집 정지 진단은 `scripts/diagnose-collection.sh`가 read-only 절차의 원본이다 |
| 조사·기술 선택 근거 | craft `research` | 외부 플러그인 | 산출물은 `docs/research/<slug>.md` 하나다 |
| AGENTS.md 지도 갱신·stale 점검 | craft `init` | 외부 플러그인 | 이 저장소의 AGENTS.md 계층과 작성권은 AGENTS.md §3이 원본이다 |

craft-skills는 vendoring·복사·setup script 없이 런타임의 native plugin marketplace로 로드한다.
Claude Code는 `.claude/settings.json`에서 marketplace `autoUpdate`와 plugin enable을 선언하고, Codex는 `.agents/plugins/marketplace.json`에서 project plugin을 `INSTALLED_BY_DEFAULT`로 선언한다.
GJC는 세션 부트스트랩의 native marketplace add/update와 project install이 project registry를 최신 marketplace 버전으로 갱신한다.
스킬 계약은 버전마다 바뀐다 — 스킬을 쓰기 전에 runtime이 로드한 버전의 `SKILL.md`를 직접 읽고, 이 문서가 낡았으면 이 문서를 고친다.
설치된 craft 스킬 중 이 표에 없는 것(`ml`·`gpu`·`vmware`·`tailscale`·`obsidian`·`distil`·`defuddle`·`ast-grep`·`skillify`·`agents`·`write-prd`·`write-report`)은 아직 이 저장소 작업에서 필요하지 않아 라우팅하지 않았다 — 쓸 수 없다는 뜻이 아니다.
필요한 작업이 실제로 생기면 그 스킬의 `SKILL.md`를 읽고 이 표에 한 행을 추가한다. 쓰지 않는 라우팅을 미리 채우면 검증되지 않은 지시가 문서에 앉는다.

## 스킬과 repo 규칙이 갈리면 repo가 이긴다

스킬은 이 저장소를 모른다.
스킬의 지시가 AGENTS.md나 `docs/rules/`·`docs/decisions/`와 어긋나면 repo 문서를 따르고, 어긋난 지점을 PR 본문에 적는다.
스킬이 설치돼 있지 않아도 작업은 막히지 않는다 — 그 표면의 repo 규칙 문서를 직접 읽고 진행한다.

아래 네 표면은 스킬에 위임하지 않는다.

- 커밋·브랜치·PR 흐름 — AGENTS.md §3·§5와 [pr-scope.md](pr-scope.md)가 원본이다. craft `git`의 커밋·브랜치 관행을 대신 따르지 않는다.
- 문서 위치 판정 — [docs/AGENTS.md](../AGENTS.md)의 canonical store 표가 원본이며 craft `document`의 문서 온톨로지를 겹쳐 쓰지 않는다.
- 공개 안전 판정 — [security.md](security.md)의 deny-list와 `scripts/check-public-safe.sh`가 원본이다. craft `security`의 범위로 대체하지 않는다.
- 훅·lint 강제 — `.githooks/`와 `commitlint.config.cjs`가 이미 이 저장소의 강제 장치이며 AGENTS.md §5·§7이 그 계약의 원본이다. craft `guardrails`로 별도 강제 계층을 새로 얹지 않는다.

## 알려진 계약 차이

| 스킬이 요구하는 것 | 이 저장소가 정한 것 | 따르는 쪽 |
| --- | --- | --- |
| craft `design`은 ownership root에 `DESIGN.md` 하나를 두고 자기 템플릿의 제목 구조를 유지한다 | 디자인 계약의 원본은 [docs/design.md](../design.md)이며 프리미티브 컴포넌트 소유권까지 그 문서가 정한다 | 이 저장소 — 새 `DESIGN.md`를 만들지 않고 `docs/design.md`를 갱신한다 |
| craft `init`은 AGENTS.md 계층을 스스로 생성·갱신한다 | AGENTS.md와 중첩 AGENTS.md는 작성권이 있는 사람이 고치며 owner 전속 경로가 있다(AGENTS.md §3) | 이 저장소 — init의 산출물은 제안으로 보고 작성권을 넘기지 않는다 |
| craft `research`는 조사마다 `docs/research/<slug>.md`와 인용 원문을 남긴다 | 기술·운영 결정의 canonical store는 `docs/decisions/` ADR이다 | 둘 다 — 조사는 `docs/research/`에, 결정은 ADR에 남기고 서로를 링크한다 |

## craft `init` 적용 결과

`init` 4.0.0(craft-skills 0.13.0)은 문서 골격을 만들지 않는다 — 자기 설명에 "Do not scaffold documentation, author document content"라고 적혀 있고 문서 작업은 `document`로 넘긴다.
그래서 이 저장소에는 문서 스캐폴딩이 아니라 AGENTS.md 지도 lifecycle만 적용한다.

최신 `init`으로 다시 inventory한 결과 root 1개와 child 25개가 기존 코드 entry/config 경계를 이미 덮고 있어 새 AGENTS placement는 만들지 않았다.
root는 요청된 `Repository Guidelines` 구조의 사람 관리 canonical guide로 두고, child 25개는 사용자의 전수 init 승인에 따라 각각 하나의 hash-checked managed region으로 통합했다.
core source, tests/QA, configs/build/deploy, scripts/docs를 canonical architect가 병렬 조사하고, frontend/backend/domain/shared-op cluster별 independent review와 correction pass를 거쳤다.
root·frontend·backend의 `CLAUDE.md` 세 파일은 init의 exact adapter 계약인 `@AGENTS.md` + LF다.

---

이 문서는 AGENTS.md §2(canonical store)를 스킬 표면으로 확장하며 규칙 본문은 재서술하지 않는다.

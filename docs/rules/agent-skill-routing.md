# 에이전트 스킬 라우팅

이 문서는 oss-hub에서 어떤 작업에 어떤 스킬을 쓰는지 정하는 원본이다.
스킬은 절차를 담고 이 저장소의 규칙은 담지 않는다 — 규칙의 원본은 항상 [AGENTS.md](../../AGENTS.md)와 그 링크 문서다.

## 표 하나가 원본이다

| 작업 표면 | 쓰는 스킬 | 스킬 위치 | 이 repo에서 함께 지키는 것 |
| --- | --- | --- | --- |
| QA 티켓 작성·발행·수행 | `manage-qa-tickets` | repo `skills/manage-qa-tickets` | 그 스킬이 자기 절차의 원본이다 |
| 릴리스 후보 QA | `run-release-qa` | repo `.claude/skills/run-release-qa` | 출시 판정은 그 스킬이 원본이다 |
| frontend 코드 구현 | craft `frontend` | 외부 플러그인 | [frontend.md](frontend.md)·[docs/design.md](../design.md)가 폴더 경계·API 클라이언트·토큰 소유권의 원본 |
| backend 코드 구현 | craft `backend` | 외부 플러그인 | [ADR-003](../decisions/ADR-003-backend-architecture.md)과 `apps/backend/src/AGENTS.md`가 계층 경계의 원본 |
| 테스트 스위트 구조 | craft `testing` | 외부 플러그인 | [ci-path-verification.md](ci-path-verification.md)가 경로별 검증 명령의 원본 |
| 화면 디자인·브랜드·토큰 시안 | `design` | 사용자 스코프 | [docs/design.md](../design.md)가 색·타이포·토큰 3-tier·컴포넌트 소유권의 원본 |
| 조사·기술 선택 근거 | craft `research` | 외부 플러그인 | 산출물은 `docs/research/<slug>.md`에 남긴다 |

`design`은 craft-skills에 없다 — 사용자 스코프에 설치된 별개 스킬이다.
craft-skills는 저장소에 vendoring하지 않은 외부 플러그인이므로 에이전트 런타임마다 설치 여부가 다르다.

## 스킬과 repo 규칙이 갈리면 repo가 이긴다

스킬은 이 저장소를 모른다.
스킬의 지시가 AGENTS.md나 `docs/rules/`·`docs/decisions/`와 어긋나면 repo 문서를 따르고, 어긋난 지점을 PR 본문에 적는다.
스킬이 설치돼 있지 않아도 작업은 막히지 않는다 — 그 표면의 repo 규칙 문서를 직접 읽고 진행한다.

아래 세 표면은 스킬에 위임하지 않는다.

- 커밋·브랜치·PR 흐름 — AGENTS.md §3·§5와 [pr-scope.md](pr-scope.md)가 원본이다.
- 문서 위치 판정 — [docs/AGENTS.md](../AGENTS.md)의 canonical store 표가 원본이며 다른 문서 온톨로지를 겹쳐 쓰지 않는다.
- 공개 안전 판정 — [security.md](security.md)의 deny-list와 `scripts/check-public-safe.sh`가 원본이다.

## craft `init` 적용 결과

craft `init`의 Phase 0 문서 골격을 이 저장소 상태와 대조한 결과다.
Phase 0은 없는 것만 만들고 있는 파일은 덮어쓰지 않는다.

| 항목 | 판정 |
| --- | --- |
| `docs/exec-plan/active`·`docs/exec-plan/archive`·`docs/decisions`·`docs/rules` | 이미 있음 — 손대지 않았다 |
| `docs/decisions/README.md`·`docs/architecture.md` | 이미 있음 — 손대지 않았다 |
| `docs/research/` | 없어서 만들었다 — craft `research`의 산출물 위치다 |

init의 `Development Flow` managed block은 이식하지 않았다.
그 블록은 "사용자가 명시적으로 요청하지 않으면 ADR을 만들거나 요구하지 말라"를 규약으로 담는데, 이 저장소는 AGENTS.md §2에서 기술·운영 결정의 canonical store를 `docs/decisions/` ADR로 이미 고정했다.
블록의 브랜치·PR·리뷰 조항도 AGENTS.md §3·§5와 [pr-scope.md](pr-scope.md)가 이미 더 구체적으로 정하고 있어, 이식하면 같은 규칙의 사본이 둘 생긴다.
`git wt` 같은 블록 안의 명령 별칭도 이 저장소에 없다.

---

이 문서는 AGENTS.md §2(canonical store)를 스킬 표면으로 확장하며 규칙 본문은 재서술하지 않는다.

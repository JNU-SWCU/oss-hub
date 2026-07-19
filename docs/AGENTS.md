<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 -->

# docs/ — 문서

## Purpose

코드가 아닌 규칙·결정·계획·상태 문서의 저장소. 루트 `AGENTS.md`가 정한 canonical store 원칙(한 사실은 한 원본에만 기록)에 따라, 대부분의 하위 문서는 특정 주제의 "원본"이며 다른 문서는 그 문서를 링크만 하고 재서술하지 않는다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `architecture.md` | 예정 저장소 구조·컴포넌트 경계 지도. 결정 근거는 `decisions/`가 원본이라 여기서 재서술하지 않는다 |
| `design.md` | Frontend 디자인 계약(색상·타이포그래피·토큰 3-tier·프리미티브 컴포넌트 소유권) — frontend 스킬 게이트가 참조 |
| `onboarding.md` | 신규 참여자용 착수 순서 안내 |

## Subdirectories

| 경로 | 내용 | 문서 |
| --- | --- | --- |
| `decisions/` | ADR(Architecture Decision Record) — 되돌리기 어려운 횡단 결정의 원본 | [decisions/README.md](decisions/README.md)(ADR 인덱스·라이프사이클) |
| `exec-plan/active/`, `exec-plan/archive/` | 기능별 실행 계획 — owner 전속 산출물(루트 AGENTS.md §3) | — |
| `handoff/` | 팀 상태 스냅샷·drift 검사 | `TEAM-STATE.md`(스냅샷, `generated_at` 48시간 경과 시 신뢰 금지), `team-state-drift-check.md` |
| `rules/` | 세부 규칙 원본(보안·frontend·PR 범위·로컬 실행·CI 경로별 검증) | 각 파일이 자기 주제의 원본 |

## For AI Agents

- **세션 부트스트랩 순서**(루트 AGENTS.md §1)는 `handoff/TEAM-STATE.md` → 자기 기능의 `exec-plan/active/<기능>.md` → 두 문서가 링크한 `rules/`·`decisions/`만 추가로 읽는 순서다. `docs/` 하위 문서를 처음부터 전부 읽지 않는다.
- **ADR 라이프사이클**(`decisions/README.md`): 결정이 바뀌면 새 ADR 파일을 만들지 않고 같은 문서를 갱신한 뒤 Changelog에 날짜·사유를 남긴다. `Proposed → Accepted → Deprecated` 상태만 쓴다.
- `exec-plan/active/*.md`는 owner 전속 경로다 — owner가 아니면 직접 수정하지 않고 Issue·PR 코멘트로 제안한다(루트 AGENTS.md §3).
- `rules/`의 각 파일이 해당 주제의 원본이다: `security.md`(public-safe deny-list·시크릿·합성 fixture 절차), `frontend.md`(feature 폴더·단일 API 클라이언트), `pr-scope.md`(PR 분해 기준), `local-dev.md`(로컬 실행 런북 — 원시 명령이 아니라 `package.json` 스크립트 이름 기준), `ci-path-verification.md`(변경 경로별 CI 검증 매핑).
- 이 저장소는 PUBLIC이다 — 새 문서를 추가하기 전 `docs/rules/security.md`의 deny-list를 확인한다.

## Dependencies

- [루트 AGENTS.md](../AGENTS.md) — 부트스트랩 순서·canonical store 표의 원본.

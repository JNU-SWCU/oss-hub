# TEAM-STATE — 팀 상태 스냅샷

> **이 문서는 스냅샷이다.** as-of 시각 기준의 과거이며 실시간이 아니다.
> `generated_at`에서 48시간이 지났으면 신뢰하지 말고 `gh pr list` · `gh issue list`로 직접 확인한다.
> 읽기 순서·작성권·상태 규칙은 [AGENTS.md](../../AGENTS.md)가 원본이다.
> 첫 회차(이 파일)는 체크포인트에 따라 수동 생성했다. 색인 스크립트(`scripts/team-state.mjs`) 도입
> 여부는 7/18 2차 생성의 소요시간 측정으로 판정한다 — 그 전까지 갱신도 수동 PR로 한다.

## 메타

| 항목 | 값 |
| --- | --- |
| generated_at | 2026-07-15T15:27:00+09:00 |
| source_commit | f74bd4f (main) |
| 조회 성공 소스 | issues, prs, ci, decisions, exec-plan, branch-protection |
| 조회 실패 소스 | 없음 |

## 지난 회차 이후 바뀐 결정

첫 회차라 이전 스냅샷이 없어 현재 유효 결정 전체를 신규로 표기한다.

- [ADR-001 테크스택](../decisions/ADR-001-테크스택.md) — Accepted
- [ADR-002 CI-CD 파이프라인](../decisions/ADR-002-CI-CD-파이프라인.md) — Accepted
- [ADR-003 backend architecture](../decisions/ADR-003-backend-architecture.md) — Accepted
- [ADR-004 REST API 규격](../decisions/ADR-004-REST-API-규격.md) — Accepted
- 규칙 문서 신설(merge됨): [security.md](../rules/security.md) (#5) · 브랜치 뒷정리(#7, AGENTS.md §7)

## 기능 상태

<!-- 상태 5종: planned / active / blocked / review / done. done은 PR merged + CI 통과 확인 시에만. -->

| 기능 | owner | 상태 | parent Issue | PR | CI | blocker (unblock owner) |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub OAuth 로그인 | @Lumiere001 | review | #9 | #13 | pass | 없음 |
| GitHub 활동 수집기 | @Lumiere001 | review | #10 | #14 | pass | #13 merge 후 base 전환 (@GoBeromsu 리뷰) |
| 중첩 AGENTS 가이드 | @Lumiere001 | review | #11 | #12 | pass | 없음 |
| 학생용 수집 App(private) | @Lumiere001 | planned | #15 | - | - | 방향 합의 + 정책 전제 4건: 산정 범위·보존·동의·App 운영 (#15) |
| (기능 1 — 지정 예정) | @GoBeromsu | planned | - | - | - | 없음 |
| (기능 3·4 — 지정 예정) | @<designer-1> @<designer-2> | planned | - | - | - | 없음 |

## 외부 게이트

<!-- 팀 밖 의존만. 사람이 아니라 작업을 주어로 쓴다. -->

| 게이트 | owner | due | fallback |
| --- | --- | --- | --- |
| 지난 학기 샘플 데이터 공유 | @nrson-jnu | 2026-07-16 | 합성 fixture로 개발 지속 |
| 운영 VM·접근권한 확보 | @nrson-jnu | 2026-07-17 | 현행 배포 구성(ADR-002) 유지 |
| 운영 TLS 종단 계약 확정 | @GoBeromsu | 배포 전 | 확정 전 운영 배포에 인증 기능 미포함 |

## 상위 리스크 5

| 리스크 | owner | trigger | due | fallback |
| --- | --- | --- | --- | --- |
| 운영 TLS 부재 시 Secure/__Host- 쿠키 미작동 | @GoBeromsu | 운영 배포 시점 | 배포 전 | 외부 terminator 계약 명시 or nginx TLS 추가 |
| 수집 App Basic 한도(5,000/hr) 부족 | @Lumiere001 | 수집 대상 확대 | 8월 실전 전 | GitHub App 인증 ADR (#15와 연계) |
| 실데이터 게이트 미충족 상태의 수합 시작 | @Lumiere001 | 8월 중순 데이터 수합 | 2026-08-15 | 리전/VM/부서검토 중 하나 선행, 전까지 합성·본인 계정만 |
| `enforce_admins=false`로 관리자가 branch protection 우회 가능 (code-owner 승인 요구 1개; push 허용 사용자 2명은 리뷰 수 아님) | @GoBeromsu @Lumiere001 | 상시 | - | 관리자 적용 여부 팀 논의 (hotfix 경로 트레이드오프) |
| 구현 마감(8/21) 대비 리뷰 병목 | @GoBeromsu | PR 대기 누적 | 2026-08-21 | 리뷰 SLA 합의 or merge 권한 위임 범위 논의 |

## CONFLICT · stale

<!-- 원본 간 충돌은 해결하지 않고 CONFLICT로만 표기한다(임의 해결 금지). -->

- CONFLICT 없음
- stale 없음 — 열린 Draft PR(#14)은 stacked 대기로 사유가 명시돼 있음

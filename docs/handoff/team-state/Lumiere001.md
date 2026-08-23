# @Lumiere001 저널

작성자 저널이다. 새 항목은 파일 끝에만 붙인다. 규칙은 루트 AGENTS.md §3이 원본이다.
| 2026-08-23 | #969 | jwt-auth-signup-refactor | Task 11 작업 중 | Task 11 (canonical authority cutover)을 5개 병렬 subagent로 분해 실행 → 통합 완료. AdminAccessActor fixture에 canonical fields 추가하여 테스트 수정. PR 준비 중. |
| 2026-08-23 | #969 | Task 13 bridge release | canonical application cutover 완료, v0.6.110 롤백을 위해 legacy physical columns/table 유지 | 이전 이미지와 bridge 이미지의 same-schema rehearsal 통과. destructive DROP/rename은 엄격히 이후 migration/PR로 연기. HEAD 7f4ccdc2이며 PR 준비 중. |
| 2026-08-23 | #160/#161 | CD responsibility boundary | builds #160/#161 failed because CD owned an unavailable auth matrix; responsibility moved out of CD; no secrets, URLs, or local paths |

## 2026-08-23 — builds #161-#163 greenfield misclassification hardening

- 상태: active
- Issue: -
- PR: 없음
- blocker: 없음
| 2026-08-24 | #969 | Task 13 contract release | legacy 역할·프로필 호환 계약 제거, 배포된 bridge는 보존하고 엄격히 더 늦은 마이그레이션으로 분리 | `20260823000000_bridge_member_authority`를 byte-for-byte 보존한 채 `20260824000000_contract_member_authority`를 추가했다. 파괴적 DDL 앞에 preflight 11종(미분류 관리자·학번 중복·미상 상태·원장 드리프트 포함)을 세웠고, 실제 PostgreSQL 17 컨테이너에서 contract/contract-negative 리허설을 통과했다(62 사용자·4 요청 id/상태 보존, 백업 복원, 직전 이미지 거부, 4개 중단 레인). 권한과 정체성은 계속 독립이다 — ADMIN에서 회원 유형을 추론하지 않는다. |

## 2026-08-23 — F4 scope cleanup

- 상태: active
- PR: #1007/#1008, #1012
- 내용: 릴리스 사고 창구의 긴급 Jenkins 수정(#1007/#1008)을 소유자 저널에 소급 기록하고, 완료된 회원 권한 backfill stage와 검증기·CI 상태 게이트 잔재를 제거했다. CD는 CI 상태를 읽지 않으며 canonical contract migration(v0.6.112) 이후 backfill을 Jenkins가 소유하지 않는다. `.openchrome` telemetry와 로컬 agent 디렉터리도 공개 저장소에서 제외했다.
- 공개 안전성: 비밀값, URL, 개인 식별 정보 없음.

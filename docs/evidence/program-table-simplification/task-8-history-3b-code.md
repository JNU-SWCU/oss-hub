# Todo 8 3b 코드 선행

기준 main은 `b07f89d16db6f2015cd791e03676eb9d829e28cb`다. 소유자가 v0.24.44 운영을 확인한 뒤 시작했다.

## 읽기 전용 집계

2026-11-04, EXIT=0. migration head는 prepare_team_history이고 미완료 migration은 0이다.

| 항목 | 건수 |
| --- | ---: |
| Preparation / participant | 0 / 0 |
| 대기 / 수락 / 거절 초대 | 3 / 20 / 5 |
| 종료 초대 | 25 |
| 종료 초대 중 이미 이력에 있는 행 | 0 |
| TeamHistory 전체 | 0 |
| 팀 / 구성원 | 40 / 72 |

종료 시각 누락, 팀 누락, 대기 초대의 응답 시각·이력 존재, 중복 대기 그룹은 모두 0이다. 운영 DB에는 쓰지 않았다.

## 코드 선행 경계

- 등록 초기화는 TeamHistory의 actorId와 초대 대상·초대자를 활동으로 확인한다.
- 새 초대 종료는 이력 기록·가입·outbox와 삭제를 한 트랜잭션에 둔다.
- Preparation DB reader·consumer를 제거하고 새 프론트도 fallback API를 호출하지 않는다. 구 프론트의 보호 GET에는 DB 조회 없는 NONE 응답만 유지한다.
- 데이터 이관까지 PENDING status 필터를 유지한다. 기존 종료 행의 이관·삭제 및 status 읽기 중단은 별도 draft PR이다.
- 이관 전 팀 삭제가 기존 종료 행을 잃지 않도록 INVITATION_ARCHIVED에 원본 status/respondedAt/updatedAt을 보존한다. 이는 실제 보관 사건이며 과거 취소·거절 행위자를 추정하지 않는다. 기존 이력이 있으면 덮어쓰지 않는다.
- 이 코드와 함께 추가하는 migration은 Preparation 0건 검사와 archive enum 추가뿐이다. 기존 행의 이동·삭제와 물리 DROP은 하지 않는다.

v0.24.44는 삭제된 초대를 활동으로 셀 수 없어 초대만 있던 사용자의 등록 초기화 보호를 잃는다. 따라서 삭제를 시작한 뒤의 rollback 하한은 이 코드 선행 릴리스다. 데이터 draft가 이 선행 앱과 호환되는지 별도로 검증하며 v0.24.44로 직접 image rollback이 안전하다고 주장하지 않는다.

## 현재 확인된 증거

기존 의미를 깨는 red는 4 failed / 35 passed였고, 팀 삭제의 legacy 종료 행 손실 red는 1 failed / 21 passed였다.

코드 변경 뒤 타깃 DB 10 suites / 193 tests가 통과했다. 변경한 HTTP·DTO 검증은 113 tests / 101 snapshots가 통과했고 프론트 reader 관련 3 files / 75 tests가 통과했다. 폐기한 Preparation 계약의 테스트는 제거하고 빈 상태 migration 거부·보호 GET·폐기 경로 404·정상 신청/초대 검증으로 대체했다. 관련 없는 DTO 사례는 그대로 유지했다.

이 문서는 코드 보존 체크포인트다. 실제 v0.24.44 rollback 대조, 데이터 이동 SQL, 서버 임시 컨테이너 리허설, 최종 PR gate는 아직 완료되지 않았다. 전체 스위트·merge·release·물리 DROP은 수행하지 않았다.

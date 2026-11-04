# Todo 8 3b 데이터 이관 draft

이 draft는 코드 선행 PR #1738이 운영되고 구 writer가 모두 종료된 뒤에만 적용한다. 지금 main/v0.24.44에 먼저 적용하지 않는다. migration의 선행 head는 `20261104150000_prepare_invitation_archival`이다. 물리 컬럼·테이블 DROP은 포함하지 않는다.

## 예상 이동과 대조

운영 읽기 전용 조회에서 Preparation 두 테이블 0, 종료 초대 25, 해당 종료 이력 0, 대기 초대 3, 팀 40, 구성원 72를 확인했다. 적용 직전 다시 집계한다. SQL도 같은 트랜잭션에서 종료 25 / ACCEPTED 20 / DECLINED 5 / PENDING 3을 강제하며, 다르면 이력 INSERT와 초대 DELETE 전에 중단한다.

| 항목          |  전 |      변경 |  후 |
| ------------- | --: | --------: | --: |
| TeamHistory   |   0 | 25 INSERT |  25 |
| ACCEPTED 초대 |  20 | 20 DELETE |   0 |
| DECLINED 초대 |   5 |  5 DELETE |   0 |
| 전체 초대     |  28 | 25 DELETE |   3 |
| PENDING 초대  |   3 |         0 |   3 |
| 팀            |  40 |         0 |  40 |
| 구성원        |  72 |         0 |  72 |

기존 종료 사실은 INVITATION_ARCHIVED/source=MIGRATION, actorId=null로 보존한다. 원본 status와 createdAt/respondedAt/updatedAt, team/program/초대 당사자 ID를 그대로 저장한다. occurredAt은 보관 사건의 시각이며 과거 거절·취소 행위자를 추정하지 않는다. 이미 올바른 이력이 있는 sourceTable/sourceId는 덮어쓰지 않는다.

Team→Invitation 순서의 SHARE ROW EXCLUSIVE 테이블 잠금으로 집계 이후 동시 쓰기까지 막고 승인 건수를 검사한다. 이력을 쓰고 원본과 대조한 뒤 종료 행만 지운다. 충돌·누락·외래키 추가·pending 이력 모순이 있으면 전체 트랜잭션이 실패한다. 마지막에 pending-only CHECK를 추가해 옛 status 갱신 writer를 거부한다.

무변경 경로는 두 가지다. 초대와 초대 출처 이력이 모두 없는 새 DB는 데이터 쓰기 없이 CHECK만 설치한다. 검증된 pending-only CHECK가 이미 있고 종료 초대가 0인 재실행은 데이터 쓰기를 건너뛴다. CHECK 없이 대기 초대만 남은 상태는 재실행으로 간주하지 않는다. 25건이어도 ACCEPTED/DECLINED 비율, EXPIRED 포함 여부 또는 PENDING 건수가 승인과 다르면 거부한다. 이 고정 범위가 운영에서 달라지면 새 집계와 승인이 필요하다.

## 롤백 하한

안전한 image rollback 하한은 #1738 코드 선행 릴리스다. 그 앱은 이력으로 활동을 판단하고 새 종료를 삭제하므로 이관 후에도 동작해야 하며 실제 전신 코드로 검증한다.

v0.24.44는 스키마가 열려도 의미상 안전하지 않다. 초대만 있던 사용자의 활동 판정을 잃어 등록 초기화가 허용된다. pending-only CHECK 뒤에는 ACCEPTED/DECLINED로 바꾸는 기존 종료 쓰기도 실패한다. 삭제된 초대 재시도는 not-pending 대신 not-found(TIV_010)다. 필요하면 승인된 백업 복원으로 복구하며 v0.24.44를 그대로 image rollback하지 않는다.

#1738의 Preparation CHECK(false) 때문에 v0.24.44 미만 앱의 준비 생성은 실패할 수 있다. v0.24.44 이상은 새 준비를 생성하지 않는다. 데이터 이관과 무관하게 별도로 공개한 한계다.

## 검증 상태

SQL 타깃은 8개 통과: 25건 원본 보존, 기존 이력 보존, 멱등성, 알 수 없는 응답 시각 보존, 모순 이력·비어 있지 않은 준비·추가 FK·ID 충돌의 원자적 거부.

이 문서의 최초 draft 공개 시점에는 서버 리허설과 status reader 제거 최종 검증은 아직 진행 중이다. 운영 데이터 쓰기·merge·배포는 하지 않는다. 서버 리허설은 운영 dump를 서버 내부 tmpfs 기반 --rm 컨테이너로만 복원하고 결과와 정리 영수증을 여기에 추가한다.

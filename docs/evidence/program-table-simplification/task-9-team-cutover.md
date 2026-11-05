# Todo 9 Team 전환 증거

2026-11-05. 백엔드 전환 A와 프론트 전환 B는 같은 릴리스에 배포하고, 물리 삭제 C는 다음 릴리스에 배포한다. 이 문서는 이관 검증을 기록하며 아직 PR 전달 완료를 뜻하지 않는다.

## 소유자가 확정한 계약 19 정정

계획의 28은 이관해야 할 AuditLog 행 수가 아니라 심사 이력이 없는 지원 수였다. 계획 파일은 수정하지 않았다.

살아 있는 지원의 사건은 TeamHistory에 정확히 한 번 보존한다. ApplicationReviewHistory 9행은 원래 occurredAt과 내용을 유지한다. AuditLog와 대상·사건·행위자가 같고 시각 차이가 1초 이하이면 같은 사건으로 짝짓는다. 실제 9쌍의 시각 차이는 3~4ms였다. 앱의 processedAt과 DB 기본 시각을 각각 기록한 같은 트랜잭션의 두 행이므로 이 소유자 판정으로 기존의 정확한 시각 일치 조건을 교체했다.

정확히 9쌍, 각 방향의 1:1 대응, 심사 9행·감사 lifecycle 62행·URL 2행 복사를 모두 검사한다. 73개 사건이 남는다. 한 조건이라도 다르면 트랜잭션을 중단한다. 이미 지워진 지원을 가리키는 AuditLog는 JOIN 대상에서 제외하며 A에서 삭제하지 않는다.

Todo 10의 중복 방지 기준:

- 심사 원본: `sourceTable = ApplicationReviewHistory`, `sourceId = 원래 심사 ID`.
- 심사와 짝지어진 감사 원본: 같은 행의 `data.pairedAuditId`. 원래 감사 시각·metadata도 `pairedAuditOccurredAt`, `pairedAuditMetadata`로 보존한다.
- 나머지 감사 원본: `sourceTable = AuditLog`, `sourceId = 원래 감사 ID`.
- 따라서 Todo 10은 AuditLog 행마다 위 두 감사 원본 키를 모두 확인한다. 짝지어진 9행을 다시 삽입하지 않는다.

## 서버 내부 복원 리허설

운영 DB에는 읽기 전용 집계와 pg_dump만 실행했다. 덤프와 복원 데이터는 같은 서버 안에 남았고 외부로 전송하지 않았다. 운영 이미지의 PostgreSQL을 재사용한 임시 컨테이너는 network none, 공개 포트 0, CPU 0.5, 메모리 및 swap 한도 각각 512MiB, nice 19, 데이터 디렉터리 tmpfs, 자동 삭제 설정이었다. rehearsal label과 익명 볼륨 0개도 검사했다.

최종 실행 직전 여유 디스크 58,956,264 KiB, 가용 메모리 11,396,156 KiB였다. 덤프 3,588,211 bytes, 권한 0600이었다. 격리 복원본에서 공식 `rehearse.sh`로 백업, 이관, 대조, 백업 복원을 실행했다. 최종 EXIT는 0이다.

| SQL | SHA-256 | 상태 |
| --- | --- | --- |
| 20261105100000_prepare_team_application_events | a28e596673d393f20362c243ce93659068739e67472d749f14559f6110169be7 | 리허설한 SQL과 현재 SQL이 같다 |
| 20261105100100_merge_applications_into_teams | 3354049b5a54f08389ab1006d705adc2250932c0290fd4331822f2becfd95fc7 | 리허설한 SQL과 현재 SQL이 같다 |
| team-application/preflight.sql | 0f717a8f3312a6a547bb774ec8089b62760b71cbd55cc59c3d0f76f660f4f852 | 리허설한 SQL과 현재 SQL이 같다 |
| team-application/reconcile.sql | d6c6485c249a19363bc7fee664c775e44ca868b0e0cd7fd82cdfd590772b86c2 | 리허설한 SQL과 현재 SQL이 같다 |

| 테이블                               | 원본 행 | 복사·재지정                           | 삭제 | 백업 복원 행 |
| ------------------------------------ | ------: | ------------------------------------- | ---: | -----------: |
| Application                          |      33 | Team으로 필드 33행 복사               |    0 |           33 |
| ApplicationReviewHistory             |       9 | TeamHistory 9행 복사                  |    0 |            9 |
| Team                                 |      40 | 기존 33행에 지원 필드 저장            |    7 |           40 |
| TeamMember                           |      72 | 0                                     |    7 |           72 |
| TeamInvitation                       |       3 | 0                                     |    0 |            3 |
| TeamHistory                          |      25 | 지원 사건 73행 + 삭제 이력 7행 삽입   |    0 |           25 |
| GithubRepository                     |       7 | teamId 7행 대조·재지정                |    0 |            7 |
| RepositoryProvisionJob               |       7 | teamId 7행 채움                       |    0 |            7 |
| RepositoryIssuanceHistory            |       0 | 0                                     |    0 |            0 |
| GithubRepositoryOutsiderContribution |       3 | teamId 3행 채움                       |    0 |            3 |
| MilestoneDocumentSubmission          |      55 | teamId 55행 채움                      |    0 |           55 |
| SubmissionFile                       |      81 | 소유 참조 76행을 teamId로 채움        |    0 |           81 |
| Notification                         |      94 | 지원 결정 payload·멱등 키 56행 재지정 |    0 |           94 |
| OutboxEvent                          |       5 | aggregate·payload·멱등 키 5행 재지정  |    0 |            5 |

이관 후 Team 33행, TeamMember 65행, TeamHistory 105행이다. 신청 없는 7개 팀은 제출·파일·레포·초대 연결이 없는지 검사한 뒤 이름·명단·삭제 건수를 이력에 남겼다. 기존 레포 소유자가 지원→팀 매핑과 다르면 이를 덮어쓰지 않고 중단한다. 고아 발급 이력과 외부 기여 캐시는 각각 0행이었다.

보호 스키마에 Application→Team ID 매핑 33행을 기록했다. 대조 불일치 0, 원본 14개 테이블의 백업 전/복원 후 행 수 불일치 0이다. A에서 테이블·컬럼 물리 삭제는 없다.

초기 리허설은 초대 전용 TeamHistory CHECK와 User의 물리 컬럼 `login`을 각각 발견하고 EXIT 1로 중단했다. 각각 전체 트랜잭션이 롤백됐다. 사건별 JSON 검증으로 CHECK를 확장하고 실제 물리 컬럼을 사용했다. 세 번째 실행은 통과했으며, 이후 소유권 불일치 가드를 추가한 최종 후보를 네 번째 실행에서 검증했다.

네 실행 모두 임시 컨테이너·덤프·private 디렉터리 잔여 0, 생성한 익명 볼륨 0이다. 최종 cleanup EXIT 0이다. 운영 DB 쓰기·배포·머지는 수행하지 않았다. 이 백업은 리허설 후 제거했으며 배포용 보존 백업이 아니다.

## 현재 자동 검증

- 변경 전 지원·팀 통합 테스트: 2 suites, 36 tests, EXIT 0.
- 새 저장 계약 red: 1 suite, 1 test 실패, EXIT 1. 기존 Team에 지원 필드가 없어서 실패했다.
- 최초 빈 DB green: 1 suite, 1 test, EXIT 0.
- 최종 이관 통합 테스트: 1 suite, 6 tests, EXIT 0. 73개 사건 보존, 원래 심사 시각, teamId 참조, 1:1 위반·1초 초과·소유권 불일치·삭제 건수 변경의 중단을 검사했다.
- 커밋 84b295d04 전체 실행: backend 통합 154 suites·1220 tests, backend 단위 382 suites·6119 tests, frontend 440 files·4739 tests, 모두 실패 0. 그 뒤 커밋은 성능 문서 삭제와 이 문서의 정리뿐이다.

## 준비 오류 정리

`PREPARATION_CHANGED`는 호출부가 없었다. 다만 `APP_031` 문자열은 레포 URL 확인 실패에도 중복 배정되어 있었다. 준비 오류를 삭제하고 실제 사용하는 GitHub 확인 실패는 `APP_036`으로 분리했다. 프론트에는 APP_031 전용 매핑이 없었다. 최종 전체 검색 결과는 전달 게이트에서 기록한다.

## 최신 main 반영과 배포 경로 감사

백엔드 작업은 `e96a686247f60096d5f72b2be5d6bc91502bd668`의 제출 축 전환과 배포 smoke 수정을 기준으로 다시 합쳤다. 제거된 제출 서비스·DTO·테스트 파일을 되살리지 않았고, 새 제출 이력 모델을 유지했다. 이 기준에서 Prisma 재생성과 backend 타입 검사는 EXIT 0이다. 전체 단위·통합 테스트는 로컬에서 실행하지 않았다.

`deploy/`의 application 경로·알림 경로·양식 카탈로그 경로를 검색했다. 활성화 smoke의 업로드 경로는 main에서 이미 `milestone-document-files`로 수정됐다. 본문 probe에는 옛 `applicationId`가 남아 있어 실제 업로드 컨트롤러가 받는 `documentId`와 `milestoneId`로 맞췄다. 실행된 curl 인자를 검사하는 테스트는 documentId 누락으로 EXIT 1, 수정 후 smoke 성공·상태 실패·전송 실패·유한 타임아웃 4개 모두 EXIT 0이었다.

현재 main의 130개 인증 경로에 의도된 Team 경로 변환만 적용했다. 기존 membership GET/DELETE는 `teams/me/membership`, 지원서 GET/PATCH/DELETE는 `teams/me`, 학생 팀장 위임은 `teams/me/leader`이다. 중복 팀 목록을 단일 경로로 합치고 위임을 추가해 총 130개를 유지했다. 실제 모듈을 읽는 인증 manifest 검증이 통과했다.

새 단위 검증에서 기존 정책과 충돌하는 테스트 가정을 발견했다. 반려 사유 필수·반려 팀 취소 금지는 소유자 결정에 따라 선택 사유·취소 허용으로 변경했다. 심사 감사 spy는 실제 TeamHistory writer 검증으로 옮겼다. 반대로 직접 승인↔반려를 제한한 초기 구현은 요청에 없는 변경이므로 기존 직접 전환을 유지하도록 복원했다. 반려 사건 외에 반려 사유가 저장되던 writer 회귀도 기존 보호 테스트로 고쳤다. 해당 심사·writer·취소 단위 검증이 통과했으며 실제 DB 통합 재검증은 아직 진행 중이다.

## 소유자 최종 성능 결정

2026-11-05 소유자는 마이그레이션을 먼저 하고 성능은 이후 확인하기로 결정했다. 성능은 merge 조건이 아니다. 추가 지연 측정·분석·성능 수정은 중단했다. 마이그레이션 완료 후 주요 조회 4개를 한 번 측정해 `program-read-baseline.json`과 비교 보고한다. 마이그레이션 전 참고 측정의 원본 JSON과 p50 표는 이 PR에 두지 않으며 커밋 84b295d04에 그대로 남아 있다.

## 최신 운영 스키마 clone 리허설

최신 운영 스키마의 clone 리허설은 커밋 cb804043dd9a098333538da9c0baa9cb55cff017에서 EXIT 0이다. 선행 migration은 20261105050000_retire_submission_axis이며 14개 원본 행 수의 backup 복구가 일치했다. Team 40→33, TeamMember 72→65, TeamHistory 25→105이고 지원 사건 73개와 빈 팀 삭제 7개를 보존한다. 볼륨 inventory 1→1, 추가·삭제 0, hash 동일; 임시 컨테이너·덤프 0. 공개 영수증은 task-9-team-rehearsal.txt다.

이 영수증은 현재 SQL을 증명한다. 이전 영수증의 커밋 34dd768441adb379fcfff927399461866ee2dceb 뒤에 커밋 afc154e1d가 merge migration과 preflight.sql을, 커밋 01699fb6e가 reconcile.sql을 바꿨고, 위 표의 해시가 이번에 리허설한 SQL이다.

같은 커밋의 복제본에서 중단 경로 13개도 실행했다. 영수증의 ABORT_OK와 ROLLBACK_OK 줄이 그 결과이며 예상 밖 결과는 0건이다.

| 경로 | 시나리오 | 결과 |
| --- | --- | --- |
| 격리 | 라벨 없는 컨테이너 | 어떤 단계도 시작하지 않고 거부 |
| preflight | 행 수 불일치, 미완료 원장 행 | 백업과 적용 전에 중단 |
| merge migration | 레포 소유 불일치, outbox 불일치, 빈 팀 의존 행 | 적용에서 중단, 대조에 닿지 않음 |
| reconcile | actor NULL, 팀 필드 변경, 이력 유실 | 대조에서 중단 |
| 원자성 | preflight 없이 직접 적용한 기준선·레포·outbox·빈 팀 불일치 4건 | 전후 행 수가 같고 새 컬럼과 백업 스키마가 없다 |

이 리허설은 psql로 적용했고 `prisma migrate deploy`를 실행하지 않았다. 실패한 migration이 Prisma 원장에 남기는 행과 Jenkins 원장 가드의 반응은 코드로만 읽었다.


## 물리 삭제 C의 운영 clone 리허설

`20261105110000_retire_application_storage`는 v0.24.58 운영 데이터의 clone에서 쓰여 있는 그대로 적용된다. 커밋 28d7ced7bcc2c2375694202c0cb624a0dcdf8cb7에서 공식 `server-rehearse.sh`와 `retire.json`이 EXIT 0이다. 14개 행 수의 백업 전/복원 후 값이 같고, `check-retired.sql` 불일치는 0이다. 공개 영수증은 task-9-retire-rehearsal.txt의 part 1이다. 그 뒤 커밋은 이 증거 문서뿐이다.

| SQL | SHA-256 |
| --- | --- |
| 20261105110000_retire_application_storage | 174a94c2267f19ab9d28533b8783763a3c2f725615fb9c747d54174272245722 |
| team-application/retire-preflight.sql | 6c58d18cf313a463a2fb65a92ba159a807fe03466f8d3c8e8efda390c84f51ce |
| team-application/check-retired.sql | 49021f57f0c4105869da57f561b1180193f795f86adf5365dcf2118cc96ec9f9 |
| team-application/retire.json | 73fcd1eb6092599146dc260299876f037687305c012735455cfc3c5275f225d0 |

가드에 고정한 값과 운영 값이 같다. Application 33, ApplicationReviewHistory 9, 매핑 33, 심사 복사본 9, 감사 복사본 64, 짝지은 감사 9다. 적용 전후에 남는 12개 테이블과 AuditLog·매핑의 행 수가 같다. `program_team_backup`은 남고 감사 화면의 지원 이름 조회는 33행을 그대로 돌려준다. 프로세서 0.5개로 제한한 clone에서 적용 시간은 1초 미만이다.

같은 커밋의 두 번째 clone에서 중단 경로를 실행했다. 예상 밖 결과는 1건이고, 제품이 아니라 검사 스크립트 오류다.

| 경로 | 시나리오 | 결과 |
| --- | --- | --- |
| 격리 | 라벨 없는 컨테이너 | 어떤 단계도 시작하지 않고 거부 |
| preflight | 미완료 원장 행, 매핑 행 삭제, 없는 팀을 가리키는 매핑 | 백업과 적용 전에 중단 |
| 공식 스크립트의 적용 | 심사 행위자 NULL, outbox 지원 집계 | 백업 뒤 적용에서 중단, 대조에 닿지 않음 |
| reconcile | 테이블 재생성, NOT NULL 유실, CHECK 유실 | 대조에서 중단, 복원 단계에 닿지 않음 |
| 직접 적용 | 가드 11종을 건드리는 변조 25건 | 정확한 가드 문구로 중단, 전후 상태 동일 |
| `prisma migrate deploy` | 정상 경로와 심사 행위자 NULL | 아래 설명 |

직접 적용 변조 하나는 실행되지 않았다. `outsider_team_null`은 변조 SQL이 `GithubRepositoryOutsiderContribution`에 없는 `id` 컬럼을 골라 migration까지 가지 못했다. 같은 반복문을 `job_team_null`과 `submission_team_null`이 지나가고, 변조 없는 대조 실행이 네 테이블 모두를 지나간다.

Jenkins와 같은 경로인 `prisma migrate deploy`는 v0.24.58 이미지에서 원장 98행을 99행으로 올리고 Jenkins 원장 가드는 전후 모두 `ordinary`다. 두 번째 실행은 적용할 것이 없고 `migrate status`도 최신이다. 남은 schema drift에 Application 관련 이름은 0건이다. 남은 항목은 집계 테이블 2개와 그 FK, `ProgramAuthoringUpload_program_actor_fkey`, `Program_createdById_*` 인덱스 2개, 인덱스 이름 2개, 그리고 운영에 부분 인덱스로 있는 `GithubRepository_teamId_key`다. 모두 이번 migration 전부터 있던 차이다.

가드가 Prisma 아래에서 중단되면 Prisma는 `current transaction is aborted`만 출력한다. 진짜 문구는 PostgreSQL 로그에만 남는다. 데이터는 롤백되지만 실패한 원장 행이 남아 Jenkins 원장 가드가 `FAIL_CLOSED`로 멈추고, 다음 `migrate deploy`는 P3009로 거부된다. 이 원장 수리는 소유자 승인이 필요한 별도 절차다.

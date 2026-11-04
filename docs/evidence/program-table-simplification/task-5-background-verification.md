# Todo 5 재게이트: background와 배포 시차

2026-11-04. 재게이트 대상은 `55a933a6f`다. 앞서 닫힌 요청 경계·경합·수집 조건은 유지한다.

## 원인과 수정

보존된 RepositoryProvisionJob은 Program 삭제 뒤에도 claim된다. 기존 공통 요청 검증은 lease와 현재 event만 검사하므로 APPROVED 신청과 활성화된 provisioning 설정을 계속 이용할 수 있었다. access-sync outbox도 terminal 작업을 다시 PENDING으로 바꿀 수 있었다.

작업을 claim 후보에서 제외하면 기존 PENDING이나 재시도 작업이 계속 남는다. 따라서 기존 claim과 이력은 보존하고, context 로드·저장소 연결·초대 준비와 결과 기록·성공 처리의 공통 요청 경계에서 DELETED를 거부한다. 기존 FEATURE_DISABLED 오류와 FAILED_FINAL 경로로 종료하며 새로운 상태나 오류 코드는 만들지 않는다. 이 실패는 멤버 지문이 달라져도 작업을 다시 활성화하지 않는다.

provider 호출 전 context에서 거부하며 provider 응답 도중 삭제된 경우도 연결 쓰기 전에 다시 검사한다. 이미 진행 중인 외부 호출의 취소를 구현한 것은 아니다. 실패 종료의 job·이력 기록은 기존 계약대로 남기고 신청·저장소 연결·초대는 바꾸지 않는다.

outbox는 삭제된 프로그램의 provision event와 access-sync event를 기존 FAILED 경로로 닫는다. 기존 terminal job을 재활성화하거나 신규 job을 만들지 않는다.

## RED와 GREEN

- 처음 추가한 fixture의 빈 collaborator 목록과 잘못된 outbox enum은 테스트 작성 오류였다. 이 실행을 결함 검출 증거로 세지 않았다.
- 유효한 fixture로 다시 실행한 RED는 2 suites / 35 tests 중 5 failed / 30 passed, EXIT=1이다. 삭제된 pending·reconciliation·provider 응답 경합과 provision/access-sync outbox가 실패했다. PUBLISHED·ARCHIVED 양성 대조는 통과했다.
- 수정 후 실제 DB 통합은 9 suites / 151 tests, EXIT=0이다. worker·outbox·job·repository와 기존 수집·상태 삭제·기한 eligibility 회귀를 함께 실행했다.
- 영향 단위 회귀는 11 suites / 155 tests, EXIT=0이다.
- 모든 DB 실행은 공용 heavy lock 안에서 빈 격리 DB에 전체 migrate deploy 후 수행했다.

## 다른 background 경로 스캔

| 경로 | 확인과 처리 |
| --- | --- |
| RepositoryOutboxConsumerService | 삭제된 프로그램의 두 event를 FAILED로 종료하고 job 변경을 막았다. |
| RepositoryProvisionWorkerService | pending과 성공 작업의 reconciliation 모두 provider 호출 없이 FAILED_FINAL로 종료한다. 실제 DB와 mock provider로 검증했다. |
| collection | 기존 PlatformRepository 공통 조건이 실제 fact 수집 직전과 외부 목록을 제외한다. 새 통합 실행에서 fact·Contribution·랭킹 보존 회귀가 통과했다. 조직 metadata 관측은 별도 기존 계약이다. |
| notifications | 신청 결정 알림 생성은 요청의 신청 승인 트랜잭션과 함께 수행되며 기존 DELETED 신청 조회 가드가 적용된다. 읽음 표시는 사용자 요청이며 background job이 아니다. |
| deadline digest | 예약·수동 선택 모두 DeadlineDigestRepository의 DELETED 제외 조회를 거친다. 삭제 상태 eligibility 회귀를 포함했다. |
| archive | 문서 archive는 예약 작업이 아닌 요청 기반 읽기이며 기존 프로그램 조회에서 DELETED를 제외한다. |
| 파일 정리 예약 세 경로 | submission-file, authoring-upload, purge-tombstone 삭제 큐는 상태 삭제 뒤에도 완료해야 하는 명시적 파일 정리 계약이다. 중단시키지 않는다. |

## 배포 순서

main 기반 frontend-only 선행 PR에서 기존·신규 backend에 모두 참인 중립 안내를 먼저 배포한다. 동작과 API는 바꾸지 않는다. 그 뒤 backend 준비 PR을 배포하고 운영 확인 후에만 정확한 보존 안내와 guide draft를 배포한다. 정확한 안내 draft는 backend 준비 PR 위에 직접 쌓는다. retire draft도 backend 준비 PR 위에 독립적으로 유지하며 옛 구조 삭제는 더 늦은 별도 릴리스와 승인 대상이다.

## 품질과 범위

공통 가드는 실제 여섯 소비 경계에 쓰이며 테스트 전용 export·새 worker·retry·normalization 계층은 없다. 테이블은 PUBLISHED·ARCHIVED 성공과 DELETED 거부를 대조하고, 부정 결과만 검사하지 않는다. provider 미호출과 신청·연결·초대 불변, terminal 종료와 기존 성공 이력 보존을 함께 검사한다.

prepare SQL은 변경하지 않았다. 기존 서버 내부 리허설을 재실행하거나 운영 DB에 쓰지 않았다. 승인된 Todo 6의 늦은 커버·양식 바이트 큐 공백은 남는다.

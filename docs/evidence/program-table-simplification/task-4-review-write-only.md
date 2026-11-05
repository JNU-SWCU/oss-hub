# Todo 4: 리뷰 호환 쓰기 중단

기준은 2026-11-05 fetch한 origin/main
`9b4a457419a7cdb674c0476ede45f83131e8e98e`다.
이 단계는 공통 심사 writer에서 ReviewHistory INSERT만 중단한다.
SubmissionHistory의 사건, revision, 처리자, 시각, 사유와 반환값은 유지한다.
단건 항목 심사, 마일스톤 심사와 일괄 보완 요청이 이 writer를 공유한다.

스키마, 마이그레이션, FK, 기존 행의 삭제 순서는 바꾸지 않는다.
resubmissionDueAt, legacySubmissionId, submissionType의 제품 코드는 건드리지 않는다.
제품 파일 삭제가 없어 파일 원장의 present/deleted 상태도 바뀌지 않는다.
review-history-writer.repository는 지원 심사의 ApplicationReviewHistory writer이므로 유지한다.

## 쓰기 제거 전 읽기 조사

기준 커밋 전체에서 `milestoneDocumentReviewHistor`,
`MilestoneDocumentReviewHistory`, `reviewHistories`를 조사했다.
직접 delegate, Prisma 역관계와 원시 SQL을 함께 확인했다.

| 읽기 | 현재 원본과 판단 |
| --- | --- |
| milestone-document-collection-read.repository | boundedReviewHistoryQuery와 findDetails는 SubmissionHistory의 심사 event를 읽는다. 전환 불필요 |
| milestone-documents.repository | 학생 요약, 수합, 트랜잭션 수합, 최신 심사, 충돌 검사, 이력 페이지 모두 SubmissionHistory를 읽는다 |
| submissions.repository, submission-reviews.repository | 기존 체크리스트와 마일스톤 심사 API도 SubmissionHistory에서 심사를 고른다 |
| student 대시보드 | SubmissionHistory를 조회한다. 기존 행 fixture의 피드백 검사를 함께 실행했다 |
| applications.repository, review-history-writer.repository | ApplicationReviewHistory를 사용한다. 이번 문서 심사 테이블과 다른 도메인이다 |
| programs.repository:500,555 | 삭제 범위의 물리 행 수와 지문을 읽는다. 신규 사건은 SubmissionHistory 집계에 포함되며 기존 ReviewHistory 행도 계속 포함해야 한다 |
| team-deletion-scope.repository:64,136 | 삭제 대상의 물리 행 수와 지문이다. 두 테이블을 모두 세는 기존 계약을 유지한다 |
| member-registration-reset.repository:118 | User 역관계 활동 검사다. 바로 앞 조건의 milestoneDocumentSubmissionHistories가 신규 reviewer의 actorId도 보호한다. 기존 행 조건도 유지한다 |
| submission-axis/check-before.sql, check-prepare.sql | 기존 ReviewHistory 행마다 대응 사건을 대조한다. 새 사건마다 옛 행을 요구하지 않는다 |
| submission-axis-preflight.sql | 옛 행 수와 전체 사건 수를 별도로 표시하며, 기존 행에서 사건으로 대조한다. 쓰기 중단 후 두 수가 같다는 해석은 잘못이다 |
| submission-axis/count-reviews.sql | 옛 물리 행 수만 센다. 이후 신규 리뷰 전체 건수를 뜻하지 않는다 |
| submission-axis/legacy-change-request-deadlines.sql | 옛 행의 기한을 조사하는 역사적 사전 점검이다. 신규 리뷰 전체 집계로 사용하면 누락된다 |
| seeds와 integration fixture | 기존 행의 cleanup DELETE를 유지한다. 과거 이관 테스트와 합성 역사 데이터 INSERT는 제품 writer가 아니다 |

Prisma 모델의 역관계는 선언으로 남는다. 과거 migration과 old-schema fixture는
역사적 입력이므로 고치지 않는다. 제품의 ReviewHistory INSERT는 공통 writer
한 곳뿐이었으며, 이 PR은 그 INSERT를 제거한다.

program-team-deletion.repository와 oss-hub seed의 ReviewHistory 선행 DELETE는
submissionHistory FK의 ON DELETE RESTRICT 때문에 계속 필요하다.
demo seed와 테스트 cleanup도 같은 이유로 유지한다.

## 롤백 발견 사항

**구형 ReviewHistory reader로의 롤백에는 사용자에게 보이는 누락이 있다.**
이번 이미지가 쓴 새 리뷰는 그 테이블에 없으므로 구형 화면의 최신 심사는
이전 판정이거나 null이 된다. 새 사유, 처리자, 처리 시각과 심사 이력은
구형 조회에서 보이지 않지만 제출 행의 현재 status는 새 판정으로 남는다.
구형 최신 심사 ID 검사도 새 심사를 인식하지 못한다.
데이터는 SubmissionHistory에 남아 있지만 이것을 무손실 이미지 롤백이라고
표현하지 않는다.

기존 submission-axis-compatibility HTTP 스펙의 세 판정에 대한 old image query는
바로 그 ReviewHistory 역관계 조회다. 이 PR은 해당 조회가 빈 배열을 반환하고
동시에 정식 사건은 정확히 한 건 남는 것을 명시적으로 검사한다.
이전 이미지 호환 보장을 조용히 삭제하거나 성공으로 보고하지 않는다.

읽기 전환 커밋 `2e0e3e492`는 v0.24.43부터 포함되어 있으며,
직전 v0.24.50 소스도 SubmissionHistory reader다. 그 소스와 동일한 이미지는
새 리뷰를 읽을 수 있다. 이 사실을 운영 배포 확인이나 모든 과거 이미지의
호환 보장으로 확장하지 않는다. 구형 테이블 reader를 자동 롤백 대상으로
허용하는 배포라면 이 PR은 그대로 배포해서는 안 된다. 게이트가 롤백 이미지의
reader를 확인해야 한다. 호환 대상 제한은 이 PR에서 배포 설정으로 강제하지 않는다.

물리 DROP, FK 변경과 cleanup 제거는 이후 릴리스다.
이번 PR은 운영 DB 쓰기, 백업, 배포, 릴리스와 머지를 수행하지 않는다.

## 행동 증거

- TDD unit red: createReview 테스트가 0회 예상, 실제 호환 INSERT 1회로 실패했다. EXIT 1.
- TDD HTTP red: 9개 중 신규 단일 쓰기 검사 1개가 옛 행 0개 예상, 실제 1개로 실패했다. EXIT 1.
- 최초 green: 격리 PostgreSQL과 object-storage에서 9 suites / 101 tests, EXIT 0.
- 새 storage 호환 스펙은 과거의 사건+호환 행과 신규 HTTP 심사를 같은 조건으로 읽는다.
  요약, 수합, 두 snapshot 경로, 최신 심사와 최신 심사 ID에서 같은 필드를 검사한다.
- HTTP 학생·교직원 이력, 일괄 요청, 기존 체크리스트, 피드백, 기존 ReviewHistory가
  남은 팀 삭제와 프로그램 삭제 회귀도 포함했다.
- 체크리스트의 ReviewHistory 단독 fixture는 실제 reader가 읽는 SubmissionHistory
  사건으로 바꿨다. 삭제 테스트와 과거+현재 출력 대조의 역사 행 fixture는 유지한다.

## 변이 검증

| 변이 | red | 복원 green |
| --- | --- | --- |
| M1: 호환 INSERT와 transaction delegate를 원래대로 복원 | 3 suites, 6 failed / 23 passed, EXIT 1. 옛 행 0개 계약과 구형 조회 누락 검사가 실패 | 4 suites / 39 tests, EXIT 0 |
| M2: 정식 심사 사건의 comment를 null로 변경 | 3 suites, 4 failed / 17 passed, EXIT 1. 학생 이력·일괄 보완·신규 수합 사유 검사가 실패 | 4 suites / 29 tests, EXIT 0 |

전체 backend unit은 389 suites / 6321 tests, EXIT 0이다.
전체 frontend는 `--maxWorkers=2`로 440 files / 4744 tests, EXIT 0이다.

M2 복원 뒤 체크리스트 fixture 전환에서 2개 검사가 실패했다. 옛 검사는 심사를
revision의 ReviewHistory 역관계에서 찾고 SubmissionHistory는 제출 두 건만
센다. 정식 사건을 넣은 fixture에서는 제출 두 건과 심사 한 건이 있으므로
총 세 사건의 종류·revision·사유·내용 보존을 직접 검사하도록 바꿨다.
실패한 검사를 삭제하거나 건너뛰지 않았다.

최종 타깃 재검사는 체크리스트 fixture 수정까지 포함하여 4 suites / 29 tests,
EXIT 0이다. 단위·통합 전체 스위트는 마지막 지시에 따라 추가 실행하지 않는다.
전체 통합은 로컬에서 실행하지 않았으며 CI가 담당한다. 빌드도 CI에 남긴다.

## 최종 로컬 게이트

모든 실행은 공유 heavy lock 안에서 직렬로 진행했다.
pnpm은 verify-deps-before-run=false를 명령행으로 전달하는 shim으로 실행했다.
의존성 재설치나 설치 확인 응답은 없었다.

| 명령 | EXIT |
| --- | ---: |
| pnpm --config.verify-deps-before-run=false --filter backend typecheck | 0 |
| pnpm --config.verify-deps-before-run=false --filter frontend typecheck | 0 |
| pnpm --config.verify-deps-before-run=false --filter backend lint | 0 |
| pnpm --config.verify-deps-before-run=false --filter frontend lint | 0 |
| pnpm --config.verify-deps-before-run=false format:check | 0 |
| pnpm --config.verify-deps-before-run=false lint:structure | 0 |
| pnpm --config.verify-deps-before-run=false check:file-ledger | 0 |

frontend lint는 변경하지 않은 frontend 파일에서 기존 링크 규칙 경고 4개를
출력했다. 에러는 0개이며 경고를 억제하거나 해당 파일을 수정하지 않았다.
boundaries의 mode 폐기 예고와 원장 실행의 Node module-type 경고도 남아 있다.

stale_state는 공식 러너의 빈 DB migration으로 확인했다. dirty_worktree는
이번 8개 파일의 diff로 범위를 확인했다. misleading_success_output은 실제
suite/test 수와 각 EXIT로 배제했다. flaky_tests는 타깃의 독립된 복원 실행에서
같은 결과를 확인했으며, 유일한 복원 실패는 위 fixture 기대값 충돌이었다.
운영 장애·실제 롤백 배포·새 migration 리허설은 이번 단계에 해당하지 않는다.

공식 통합 러너가 빈 DB에 전체 기존 migration을 적용하고 종료 시 컨테이너와
볼륨을 제거한다. 새 migration이 없으므로 별도 운영 데이터 리허설과 운영 집계는
수행하지 않는다. 이번 PR의 비가역적 데이터 삭제는 0건이다.

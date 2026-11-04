# Todo 4 백엔드 준비 검증

이 증거는 백엔드 준비 단계에 한정한다. 프론트 전환, 코드 참조 중단,
물리 삭제는 구현하지 않았으며 완성된 draft로 제출하지 않는다.

## 초기 실행 결과 (게이트 수정 전)

| 검사 | 실행 결과 |
| --- | --- |
| backend 전체 단위 테스트 | 390 suites, 6,333 tests, 309 snapshots, EXIT 0 |
| 이관·신구 API·재제출·파일·자기 팀 심사 통합 | 5 suites, 61 tests, EXIT 0 |
| 구조 lint | EXIT 0 |
| 포맷 | EXIT 0 |
| backend lint / typecheck | 각각 EXIT 0 |
| frontend lint / typecheck | 각각 EXIT 0 |
| 파일 원장 | 259 paths, EXIT 0 |
| 실제 가이드 빌드 | 42 pages, EXIT 0 |
| 서버 내부 준비 이관 리허설 | 대조 불일치 0, 백업 재복원 일치, EXIT 0 |
| 동일 DB 교차 성능 비교 | 1 suite, 1 test, 경로·버전별 100 표본, EXIT 0 |

전체 단위·5개 통합 검사는 준비 커밋 `2e0e3e492`의 코드에서 실행했다.
그 뒤 FILE 내용 표식의 호환 공백을 수정하고 영향 범위를 다시 검사했다:

| FILE 호환 후속 검사 | 실행 결과 |
| --- | --- |
| 파일 HTTP + PostgreSQL + object storage | 1 suite, 19 tests, EXIT 0 |
| 항목 제출 서비스 단위 검사 | 1 suite, 89 tests, EXIT 0 |
| 구형 검토 화면 내용 표시 함수 | 1 file, 7 tests, EXIT 0 |
| backend lint / typecheck, 전체 포맷 | 모두 EXIT 0 |

후속 변경은 FILE 입력 규칙의 JSON 내용 표식만 보존한다. 파일명·크기·저장 키
등 파일 메타데이터는 복제하지 않는다. 성능 비교 대상인 네 조회 구현은
바뀌지 않았으며 해당 소스 해시는 성능 JSON에 기록했다.

프론트 lint의 기존 경고 4개는 변경하지 않은
`src/app/_shell/shell-menu-sheet.test.tsx:20`의 3개와
`src/components/failure-state.test.tsx:56`의 1개다. 모두 `<a>` 대신 Next Link를
권하는 경고다. 프론트 제품 소스 변경은 없다.

가이드는 workspace의 `apps/*` 밖에 있다. 처음
`pnpm --filter oss-hub-guide build`는 `No projects matched`를 출력했으므로
그 EXIT 0을 성공 증거에서 제외했다. `pnpm --dir guide build`로 실제
42페이지 빌드를 실행해 `GUIDE_BUILD_ACTUAL_EXIT=0`을 확인했다.

## 공개 계약의 검증

- 기존 목록 요청은 기존 범위를 유지하고 `scope=all`에서만 레거시 항목을 포함한다.
- 구형 제출 API의 공개 ID로 항목 API에서 읽고 다시 제출해도 제출 행은 하나다.
- 구형 심사 뒤 오래된 항목 심사 요청은 409이며, 기존 승인 이벤트를 덮어쓰지 않는다.
- 관측 revision이 같은 동시 제출 두 건은 201과 409로 나뉘고 이력은 한 번만 늘어난다.
- FILE, TEXT, FILE_OR_TEXT의 9가지 글·파일 조합과 선택 코멘트를 실제 HTTP로 검사했다.
- FILE 항목 API가 저장한 자료를 구형 `review-context`도 FILE 표식과 첨부 파일로 읽는다.
- `comment:null`의 500을 재현한 뒤 201과 이력의 null 코멘트를 확인했다.
- 반려·보완 요청 사유는 선택이며, 입력한 사유는 학생 이력에 남는다.
- 구형 재제출 기한 필드는 받아서 무시한다. 마일스톤 마감·유예와 마감 후 보완 1회는 유지한다.
- 자기 팀 심사 금지, 다른 팀 교직원·관리자 심사, 현재 파일 권한과 보존 기간을 유지한다.
- 공개 ID 충돌·대기 파일 소유권 모호성·심사 ID 충돌은 이관 전 원자적으로 거부한다.
- 기존 심사 ID·코멘트를 보존하며 구형 앱의 심사/이벤트 INSERT 순서가 달라도 대조가 맞는다.

## 바뀐 테스트의 대응

| 이전 검증 | 새 계약의 검증 |
| --- | --- |
| 반려·보완 요청에 필수 사유 오류 | 사유 생략·공백은 null, 입력 사유는 trim 후 보존 |
| 필수 재제출 기한 및 미래 날짜 검사 | 구형 날짜 필드를 받아 무시하고 기한 없이 심사 |
| 재제출 기한 경과 차단 | 보완 요청 상태에서 마감 후 한 번 허용, 이미 사용했거나 최종 판정이면 차단 |
| 별도 ReviewHistory 생성 | SubmissionHistory에 심사 이벤트 한 건, 옛 테이블 새 쓰기 없음 |
| 심사 기한을 이력으로 복사 | 심사 ID·판정·처리자·시각·코멘트 보존, 기한 이관 없음 |
| FILE 항목의 빈 내용 저장 | FILE 표식 유지와 구형 검토 응답 확인 |

자기 팀 심사 금지, 권한, 파일 접근, revision 충돌, 최종 판정과 유예의
검사는 유지했다. 테스트를 skip하거나 타입·lint 오류를 억제하지 않았다.

## 재현 명령과 점검 범위

```sh
pnpm --filter backend test:unit --runInBand
BACKEND_INTEGRATION_TEST_PATTERN='(program-submission-axis-migration|submission-axis-compatibility.http|milestone-document-resubmission.http|milestone-document-files.http|submission-self-review)\.integration\.spec\.ts \
  pnpm --filter backend test:integration
pnpm lint:structure
pnpm format:check
pnpm --filter backend lint
pnpm --filter backend typecheck
pnpm --filter frontend lint
pnpm --filter frontend typecheck
pnpm check:file-ledger
pnpm --dir guide build
pnpm --filter frontend exec vitest run --maxWorkers=2 src/features/reviews/review-format.test.ts
```

공식 통합 러너가 매번 빈 격리 DB에 전체 migration을 적용하므로 오래된 DB
상태를 성공으로 오인하지 않았다. dirty worktree는 커밋 대상 diff로 확인했다.
`No projects matched`를 성공에서 제외했고 모든 테스트 결과에는 실제 개수를
기록했다. 동시성 시나리오는 여러 격리 실행에서 통과했다. 발견한 실패는
필수 조건 변경에 따른 기대값, 추가 잠금의 테스트 픽스처, nullable 코멘트,
FILE 내용 표식의 재현 가능한 원인이었다.

그 밖의 장애 주입은 이번 준비 단계의 검사 범위가 아니다. 운영 배포,
운영 DB 쓰기, 물리 테이블·컬럼 삭제는 실행하지 않았다.

## 게이트 B1·B2 수정

준비 릴리스는 새 심사 이벤트와 동일 ID의 옛 ReviewHistory를 같은 트랜잭션에 기록한다. 제출 revision의 이력 ID, 처리자, 시각, 사유를 보존한다. 신규 심사 후 구형 조회 형태로 세 판정을 읽고, 호환 FK 쓰기가 실패하면 양쪽 기록과 상태 변경이 롤백되는 통합 검증을 추가했다. 위 초기 검증의 “옛 테이블 새 쓰기 없음”은 현재 계약이 아니며 이 절로 대체된다. 이중 쓰기는 구형 조회를 제거하는 코드 참조 중단 릴리스에서만 끝낸다.

기한 약속을 고치는 선행 프론트 PR이 먼저 배포되어야 한다. #1731에는 프론트·guide 변경을 남기지 않는다. 기존 폼의 사유·날짜 필수 검증은 그대로인 동안 API만 선택 사유를 받는다. 보완 요청마다 마감 후 한 번 제출할 수 있고 별도 만료는 없다. 사유가 없으면 레거시 체크리스트는 코멘트 행을 생략하고, 항목 화면은 “사유 없이 저장되었습니다.”를 표시한다.

Todo 5를 포함한 main 8261fc711을 통합했다. MilestoneDocument→SubmissionFile FK와 공통 PURGE_RELATIONS의 submission-files 행을 보존했고, 관계 행렬 타깃 검사가 통과했다.

## main 8261fc711 통합과 DELETED 쓰기 보호

이력 재작성 없이 main을 병합한다. ProgramsModule 충돌은 제출 저장소의 새 경로와 main의 ProgramDeletionScopeRepository 경로를 모두 유지하여 해결했다. 준비 manifest의 expectedHeadMigration은 main의 20261104050000_prepare_program_absorption으로 갱신했다.

제출의 기존 lockSubmissionMembership은 프로그램 행을 잠근 뒤 DELETED를 거부한다. HTTP 신규·교체 제출의 403 계약과 사전 조회 뒤 삭제된 경우의 저장소 거부를 실제 DB로 확인했다. 이 경로는 수정하지 않았다.

단건 심사는 삭제 상태에서도 201과 새 기록을 만들 수 있어 수정했다. 단건·일괄 심사가 트랜잭션 맨 처음에 Program 행을 FOR SHARE로 잠그고 lifecycle을 확인한다. 삭제되었으면 문서·신청 잠금이나 쓰기 전에 404로 거부한다. 이 잠금은 삭제 UPDATE와 직렬화되므로 사전 조회 후 삭제되는 경계도 보호한다.

- DB 신규 회귀 및 호환: 16 tests, EXIT 0. 제출·단건·일괄 거부 뒤 기록이 바뀌지 않는지 검사했다.
- main의 기존 삭제 차단·재제출·일괄 심사 DB: 3 suites, 79 tests 통과.
- 심사 서비스·저장소·관계 행렬: 4 suites, 134 tests, EXIT 0.
- backend typecheck: EXIT 0.
- 모든 테스트와 typecheck는 공유 heavy lock 안에서 pnpm --config.verify-deps-before-run=false로 실행했다. 전체 스위트·빌드·성능 측정·운영 리허설은 재실행하지 않았다. 이전 서버 리허설은 당시 head 기준 증거이며 이번 통합 후 재실행 결과로 표시하지 않는다.

검증 도중 main이 e40766704(#1734 안내와 #1727 GitHub 정리, #1735 안내 포함)로 전진하여 추가 병합했다. 신규 제출·심사 구현과 파일 관계 코드는 동일하며, 추가된 DB CHECK migration에 맞춰 manifest의 예상 head를 20261104130000_retire_teamless_github_repositories로 갱신했다. 이에 영향을 받는 삭제 차단·제출 호환 DB 2 suites / 76 tests와 backend typecheck만 추가 확인했고 모두 EXIT 0이었다.

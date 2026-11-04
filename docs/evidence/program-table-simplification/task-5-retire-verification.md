# Todo 5 후속 구조 삭제 검증

선행 PR: #1725, 준비 코드 `55a933a6f26e416a5ad2478f9af7e7e9cda4ca01`.
이 후속 PR은 draft이며 준비 backend의 운영 확인과 새 백업·소유자 삭제 승인 뒤에만 별도 릴리스로 적용한다. 새 안내와 guide는 별도 frontend draft로 분리하며, retire 배포의 선행 조건으로 묶지 않는다.

## 변경과 불변식

`20261104050100_retire_program_creation_request`는 먼저 생성자·키·해시와 업로드 연결을 대조한다. 불일치가 있으면 DROP 전에 예외로 중단한다. 일치하면 임시 bridge 두 개와 옛 업로드 FK 컬럼 두 개, ProgramCreateRequest 테이블을 제거한다.

Program, 업로드 ID, 새 연결과 생성 사실, 팀·지원·제출·이력 행은 삭제하지 않는다. 앱과 API·화면 코드는 준비 커밋과 같다. 가이드 변경은 별도 frontend draft에 포함된다.

SQL SHA-256은 서버 실제 데이터 복원 리허설의 입력과 동일하다.

```text
637fe6e3f28f593cdebf8afdb12568a6e31004a3c9fbb4963efe2c48601a4bf7
```

## 회귀 검증

대조 가드의 Program 비교를 일시적으로 무효화한 변이에서는 불일치 fixture가 거부되지 않아 정확히 1건이 RED였다(12 passed / 1 failed, EXIT=1). 원래 SQL을 바이트 단위로 복구했고 위 해시와 일치했다.

빈 격리 DB에서 전체 migrate deploy 후 다음을 실행했다.

```sh
BACKEND_INTEGRATION_TEST_PATTERN='(program-create-request-migration|program-authoring.service|program-purge|program-lifecycle).integration.spec.ts$' pnpm --filter backend test:integration
```

```text
Test Suites: 4 passed, 4 total
Tests:       50 passed, 50 total
RETIRE_INTEGRATION_EXIT=0
RETIRE_GATES_EXIT=0
```

위 4 suites / 50 tests와 타입 검사·변경 spec ESLint·format:check·파일 원장은 최초 retire 커밋의 실행 증거다. 준비 수정 HEAD의 backend 전체 unit 390 suites / 6314 tests와 정적 검증은 앱 코드가 같으므로 승계한다. frontend 71 tests·E2E 9 tests·guide 빌드는 별도 copy draft의 기존 증거이며 이 SQL 후속의 새 실행으로 표시하지 않는다.

서버 내부 prepare → retire 리허설과 백업 복원 대조는 `task-5-server-rehearsal.md`에 있다. 운영 데이터에는 적용하지 않았다. 후속 삭제 전에 운영 집계를 다시 확인해야 한다.

## 현재 집계 기준 물리 삭제

- ProgramCreateRequest 9행.
- 업로드의 createRequestActorId·createRequestId 두 컬럼. 비NULL 값 합계 4개.
- 최종 모델에 남지 않는 요청 대리키 9개와 요청 시각 9개. 생성자·멱등 키·해시는 Program에, 첨부 대상은 programId에 보존한다.
- Program과 하위 도메인 행 삭제 0건.

늦게 연결된 커버·양식 바이트 정리는 소유자가 승인한 Todo 6 범위다. 삭제 후 쓰기와 수집 경계의 수정은 준비 코드에서 승계하며 이 SQL 전용 PR에서 다시 구현하지 않는다.

# Todo 5 후속 구조 삭제 검증

선행 PR: #1725, 준비 코드 `fa514a6e0424ad05ac0857e60b19655a76673b5e`.
이 후속 PR은 draft이며 준비의 frontend·backend 배포와 새 백업·소유자 삭제 승인 뒤에만 별도 릴리스로 적용한다.

## 변경과 불변식

`20261104050100_retire_program_creation_request`는 먼저 생성자·키·해시와 업로드 연결을 대조한다. 불일치가 있으면 DROP 전에 예외로 중단한다. 일치하면 임시 bridge 두 개와 옛 업로드 FK 컬럼 두 개, ProgramCreateRequest 테이블을 제거한다.

Program, 업로드 ID, 새 연결과 생성 사실, 팀·지원·제출·이력 행은 삭제하지 않는다. 앱과 API·화면 코드는 준비 커밋과 같다. 가이드 변경은 선행 PR에 포함되어 있다.

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

타입 검사, 변경된 통합 spec의 ESLint, 전체 format:check, 파일 원장도 순차 성공했다. 준비의 backend 전체 unit 390 suites / 6314 tests, frontend 71 tests, 관련 E2E 9 tests, 구조·양쪽 lint·양쪽 typecheck·가이드 빌드는 앱 코드 변경이 없으므로 그대로 승계한다.

서버 내부 prepare → retire 리허설과 백업 복원 대조는 `task-5-server-rehearsal.md`에 있다. 운영 데이터에는 적용하지 않았다. 후속 삭제 전에 운영 집계를 다시 확인해야 한다.

## 현재 집계 기준 물리 삭제

- ProgramCreateRequest 9행.
- 업로드의 createRequestActorId·createRequestId 두 컬럼. 비NULL 값 합계 4개.
- 최종 모델에 남지 않는 요청 대리키 9개와 요청 시각 9개. 생성자·멱등 키·해시는 Program에, 첨부 대상은 programId에 보존한다.
- Program과 하위 도메인 행 삭제 0건.

늦게 연결된 커버·양식 바이트 정리와 기존 무가드 쓰기 경계 등 선행 PR의 승인된 후속 항목은 이 SQL 전용 PR에서 추가 구현하지 않는다.

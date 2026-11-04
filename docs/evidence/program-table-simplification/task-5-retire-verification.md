# Todo 5 후속 구조 삭제 검증

선행 PR: #1725, 운영 확인 버전 v0.24.38. main `370ba6a5c` 위에 원래 merge 커밋의 retire 변경을 재적용하고 파일 원장의 양쪽 기록을 보존했다.
이 후속 PR은 draft이며 준비 backend의 운영 확인과 새 백업·소유자 삭제 승인 뒤에만 별도 릴리스로 적용한다. 새 안내와 guide는 별도 frontend draft로 분리하며, retire 배포의 선행 조건으로 묶지 않는다.

## 변경과 불변식

`20261104170000_retire_program_creation_request`는 먼저 생성자·키·해시와 업로드 연결을 대조한다. 불일치가 있으면 DROP 전에 예외로 중단한다. 일치하면 임시 bridge 두 개와 옛 업로드 FK 컬럼 두 개, ProgramCreateRequest 테이블을 제거한다.

Program, 업로드 ID, 새 연결과 생성 사실, 팀·지원·제출·이력 행은 삭제하지 않는다. 앱과 API·화면 코드는 준비 커밋과 같다. 가이드 변경은 별도 frontend draft에 포함된다.

SQL SHA-256은 서버 실제 데이터 복원 리허설의 입력과 동일하다.

main의 `20261104140000_prepare_team_history`와 형제 PR의 `20261104150000_prepare_invitation_archival`, `20261104160000_retire_terminal_invitations` 뒤에 정렬되도록 폴더 이름과 테스트의 참조 경로만 바꿨다. SQL 바이트는 변경하지 않았다. 아래 해시는 이름 변경 전후에 동일하다. 이번 갱신에서 서버 리허설을 새로 실행하지 않았으며, 아래의 기존 리허설을 새 tmpfs 실행으로 표시하지 않는다.

기존 CI run `41799700745`는 관리자 승인 fixture가 `9100002` 학번을 지명 지원 fixture와 공유해 User.studentId 유니크 제약에서 실패했다. main의 `bf68bece9`는 승인 대상의 고유 githubId를 학번으로 사용한다. 이번 rebase는 이 수정도 반영하며 테스트·assertion·이관 가드를 삭제하거나 완화하지 않는다.

```text
637fe6e3f28f593cdebf8afdb12568a6e31004a3c9fbb4963efe2c48601a4bf7
```

## 회귀 검증

2026-11-04 rebase 후 로컬 전용 PostgreSQL의 빈 `oss_hub_test` DB에 전체 migration을 적용했다. Jest `--maxWorkers=2 --runTestsByPath`로 `program-create-request-migration.integration.spec.ts`, `applications-named-invitees.integration.spec.ts`, `admin-access-mutation.integration.spec.ts`를 실행해 3 suites / 32 tests가 통과했다. 실행 종료 코드는 0이며 임시 DB 서버와 데이터 디렉터리, 공용 heavy lock을 정리했다.

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

2026-11-04 08:11:23 UTC, 운영 DB의 동일 REPEATABLE READ snapshot에서 READ ONLY 집계를 두 번 실행해 일치를 확인했다. 운영 migration이나 데이터 변경은 실행하지 않았다.

| 물리 제거·보존 항목 | 실제 재집계 |
| --- | ---: |
| 제거할 ProgramCreateRequest 테이블 | 1 |
| 제거할 요청 행 | 9 |
| 요청 테이블과 함께 제거할 컬럼 | 6 |
| 요청 고유 ID 값 | 9 |
| 요청 createdAt 값 | 9 |
| 업로드에서 별도로 제거할 옛 FK 컬럼 | 2 |
| createRequestActorId 비NULL 값 | 2 |
| createRequestId 비NULL 값 | 2 |
| 옛 업로드 FK 비NULL 값 합계 | 4 |
| 유지할 Program 행 | 10 |
| 유지할 ProgramAuthoringUpload 행 | 3 |
| 생성자·키·해시가 Program과 일치하는 요청 | 9 |
| programId 연결이 일치하는 옛 FK 업로드 | 2 |
| 요청·업로드 대조 불일치 | 0 |
| 제거할 bridge trigger / function | 2 / 2 |

별도 ALTER에서 지울 컬럼은 2개이고, 제거되는 요청 테이블의 6개 컬럼까지 합하면 물리 스키마에서 없어지는 컬럼은 8개다. 생성자·멱등 키·해시와 프로그램 연결은 이미 보존되며, 요청 테이블의 고유 ID와 createdAt 직접 필드는 최종 모델에 남지 않는다. 두 FK 컬럼의 4개 값도 직접 필드로는 남지 않지만 업로드의 새 programId 연결은 유지된다.

- ProgramCreateRequest 9행.
- 업로드의 createRequestActorId·createRequestId 두 컬럼. 비NULL 값 합계 4개.
- 최종 모델에 남지 않는 요청 대리키 9개와 요청 시각 9개. 생성자·멱등 키·해시는 Program에, 첨부 대상은 programId에 보존한다.
- Program과 하위 도메인 행 삭제 0건.

늦게 연결된 커버·양식 바이트 정리는 소유자가 승인한 Todo 6 범위다. 삭제 후 쓰기와 수집 경계의 수정은 준비 코드에서 승계하며 이 SQL 전용 PR에서 다시 구현하지 않는다.

# Todo 2 운영 집계와 서버 내부 복원 리허설

2026-11-03 후속 검증이다. 기존 `task-2-prepare.txt`의 초기 로컬 검증을 보완한다.
이 커밋은 증거 문서만 추가한다. 제품 코드, 후보 SQL, 운영 설정을 변경하지 않았으며 PR을 머지하지 않았다.

## 결론

현재 운영 집계의 데이터 차단 조건은 모두 0이다. 같은 서버 안의 격리 복원본에서 prepare와 retire가 모두 성공했다. 최종 공식 리허설과 독립 정리 확인은 각각 `EXIT=0`이다.

이 결과는 실제 운영 마이그레이션 실행이나 배포 승인이 아니다. 준비 릴리스의 두 앱을 먼저 배포하고, 별도 릴리스에서 retire를 적용해야 한다. 실제 배포 시점에는 사전 점검과 보존할 백업을 다시 수행한다.

## 고정한 입력

| 입력 | 버전 또는 SHA-256 |
| --- | --- |
| prepare 제품 소스 | `92f2bff157d5691ea53ff891fa1e6a54a56c0065` |
| prepare SQL | `a381db6f234a508f45f6478f4cbec54e4046795fae3e52764bb363a8e1340c0a` |
| retire 제품 소스 | `c706355d1e7de81258708a4ef77eaa99b09a3681` |
| retire SQL | `e83390b7d6cc95c20a37b79515cc161beb706b97f9dd37d749f633a7c6102fb8` |
| `deploy/jenkins/program-migration/rehearse.sh`와 관련 도구 | main의 `d13bf30db9bd7c1900ef20fba515e58f3f661402` |

도구와 두 후보 SQL의 체크섬을 검증했다. 공식 도구와 후보 SQL은 수정하지 않았다.

## 운영 읽기 전용 집계

`PGOPTIONS`의 `default_transaction_read_only=on`과 `REPEATABLE READ READ ONLY` 트랜잭션을 함께 사용했다. 세션의 default/transaction read-only 값 모두 `on`이었다. `EXIT=0`.

| 검사 | 결과 |
| --- | ---: |
| SubmissionFile 중복 storageKey 그룹 | 0 |
| MilestoneDocumentTemplateFile 중복 storageKey 그룹 | 0 |
| Program sentinel 시작일 | 0 |
| Milestone sentinel 시작일 | 0 |
| 프로그램 범위 밖 마일스톤 | 0 |
| TeamMember 중복 복합키 | 0 |
| TeamMember NULL 키 | 0 |
| TeamMember incoming FK | 0 |
| 미완료 마이그레이션 | 0 |
| 완료된 마이그레이션 | 84 |
| prepare / retire 운영 적용 기록 | 0 / 0 |
| 복사해야 할 초대 시각 | 28 |

TeamMember의 기존 복합 UNIQUE 인덱스는 unique/valid/ready였다. 현재 PK는 id이며 프로그램당 한 팀 UNIQUE도 유지되어 있다. 검사한 관련 제약 13개가 validated 상태였다. prepare가 만들 두 storageKey 인덱스 이름은 아직 존재하지 않았다.
현재 마지막 완료 마이그레이션은 `20261103130000_cycle_snapshot_daily`였다.

## 격리와 자원 제한

- 운영 DB에는 읽기 전용 조회와 `pg_dump`만 실행했다. 덤프와 모든 복원 데이터는 서버 밖으로 옮기지 않았다.
- 최초 DB 크기: 20,494,003 bytes. 실제 SQL 덤프: 3,634,590 bytes.
- 덤프 후 필수 여유 공간: 10,903,770 bytes. 실제 여유 공간: 58,267,598,848 bytes.
- 실행 직전 가용 메모리: 11,157,577,728 bytes.
- private 디렉터리 모드 0700, 덤프 모드 0600을 확인했다.
- 운영과 같은 PostgreSQL 17 이미지 ID를 재사용했다. 새 임시 컨테이너는 network none, published ports 0이었다.
- CPU 0.5, 메모리 512MiB, memory+swap 512MiB, nice 19를 실제 inspect/프로세스 값으로 확인했다.
- `oss-hub.program-migration.rehearsal=true` label을 확인했다. 임시 컨테이너에는 앱 네트워크와 운영 데이터 볼륨을 연결하지 않았다.

## 실제 실행 순서

고정된 공식 `rehearse.sh`와 manifest를 사용했다. expected migration head는 위 운영 집계와 같았다. baseline/검증 행 정리는 계측 단계이고, 실제 후보 마이그레이션은 prepare와 retire 두 개다.

1. 서버 내부 덤프를 임시 컨테이너의 새 DB에 복원하고 읽기 전용 preflight를 통과했다.
2. 원본 행 수를 기록하고 prepare SQL을 적용했다.
3. `teamId/programId/userId`만 쓰는 post-prepare 형태로 TeamMember 1행을 실제 INSERT·COMMIT했다. 옛 id 기본값이 채워지는 것도 확인했다.
4. 공식 도구로 retire 직전 복원본을 백업했다.
5. retire SQL을 적용하고 복합 PK, 옛 컬럼 부재, 중복 거부를 확인했다.
6. 검증용 행을 제거하고 최초 행 수와 대조했다.
7. 공식 도구가 retire 직전 백업을 다른 임시 DB에 다시 복원했다. 7개 테이블의 백업 전/복원 후 행 수가 모두 일치했다.

| 테이블 | 최초 | prepare + 검증 행 | retire 후 | 검증 행 제거 후 |
| --- | ---: | ---: | ---: | ---: |
| Program | 10 | 10 | 10 | 10 |
| Milestone | 20 | 20 | 20 | 20 |
| SubmissionFile | 81 | 81 | 81 | 81 |
| MilestoneDocumentTemplateFile | 5 | 5 | 5 | 5 |
| Team | 40 | 40 | 40 | 40 |
| TeamMember | 72 | 73 | 73 | 72 |
| TeamInvitation | 28 | 28 | 28 | 28 |

의도한 검증 행 1개 외의 행 수 불일치는 모든 단계에서 0이었다. 초대 28건의 원래 invitedAt과 새 createdAt의 불일치도 prepare/retire 뒤 모두 0이었다.
중복 storageKey INSERT는 `SubmissionFile_storageKey_key`의 unique violation으로 거부됐다. 다른 오류를 성공으로 취급하지 않았으며 검증용 파일 행도 제거했다.
retire 후 PK는 `(teamId,userId)`, 옛 컬럼 잔여 수는 0이었다.

## 실패 경로와 정리 영수증

초기 두 실행은 후보 SQL에 도달하기 전 계측 함수의 CASE 구문 오류로 `EXIT=1`이었다. 각 실행에서도 컨테이너·덤프·private 디렉터리는 제거됐다. 개인정보 없는 합성 DB에서 계측 SQL의 red/green을 확인한 뒤 다시 실행했다. 후보 SQL은 바꾸지 않았다.

최종 서버 실행 영수증:

```json
{"check":"official_rehearsal","EXIT":0}
{"check":"server_cleanup","owned_containers_remaining":0,"private_dirs_remaining":0,"dump_files_remaining":0,"ownership_error":0,"EXIT":0}
```

별도 SSH 연결로 세 번의 실행을 다시 확인했다:

```json
{"check":"independent_server_cleanup","runs_checked":3,"owned_containers_remaining":0,"private_dirs_remaining":0,"rollback_secret_still_present":1}
```

독립 확인 `EXIT=0`. 원본 SQL 덤프와 리허설 내부 백업은 모두 제거했다. 배포용으로 보존된 백업이라고 주장하지 않는다. 공개 증거에는 집계·설정 상태만 담았고 개인별 행이나 secret 값을 담지 않았다.

## 지정된 통합 테스트

`apps/backend`에서 다음을 그대로 실행했다:

```sh
BACKEND_INTEGRATION_TEST_PATTERN='(schema-invariants|team-invitations.integration|program-teams.integration)' bash test/run-integration.sh
```

```text
PASS src/programs/program-teams.integration.spec.ts
PASS prisma/schema-invariants.integration.spec.ts
PASS src/programs/team-invitations.integration.spec.ts
Test Suites: 3 passed, 3 total
Tests:       16 passed, 16 total
EXIT=0
```

## 롤백 secret 확인의 범위

운영 backend 설정에 non-empty `TEAM_JOIN_CODE_SECRET`이 있고 활성 compose에 전달 항목이 있음을 확인했다. 마지막 독립 확인에서도 존재했다. 값을 출력하거나 변경하지 않았다.

단, **#1718의 후보 `compose.yml`은 이 전달 항목을 삭제하고 환경 검증기의 필수 조건도 제거한다.** 따라서 “후보 compose에서도 삭제하지 않는다”는 주장은 맞지 않는다. PR은 별도로 관리되는 운영 환경 credential을 수정하는 코드는 포함하지 않는다.

롤백 코드는 스냅샷된 이전 compose와 동일한 운영 환경 credential을 사용한다. 이 credential에서 해당 값을 제거하면 안 된다. Compose label은 읽을 수 있는 원본 환경 파일을 제공하지 않아 credential 내용을 직접 복호화·조회했다고 주장하지 않는다. 이번 후속 작업은 지시대로 제품 코드 변경 없이 이 사실을 기록한다.

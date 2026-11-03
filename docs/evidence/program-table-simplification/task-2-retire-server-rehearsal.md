# Todo 2 retire: 운영 데이터의 서버 내부 복원 검증

2026-11-03 후속 증거다. 제품 코드와 두 후보 SQL을 바꾸지 않고 문서만 추가했다. 운영 DB에 마이그레이션을 실행하거나 PR을 머지하지 않았다.

## 결과

**현재 운영 집계의 차단 항목은 모두 0이며, 해당 덤프를 복원한 격리 DB에서 prepare와 retire 모두 통과했다. 최종 리허설 `EXIT=0`.**

실제 배포는 여전히 두 릴리스다. #1718의 backend와 frontend가 먼저 배포되어야 한다. 이 PR은 그때까지 draft로 유지한다. 데이터 검증 통과가 실행 중인 앱 버전 확인이나 배포 당일 백업을 대신하지 않는다.

상세 사전 집계·자원 제한·절차·secret 확인 범위는 [준비 단계의 서버 리허설 기록](https://github.com/JNU-SWCU/oss-hub/blob/150166d879b7fd5a7d6835eac85d8680dadde7d8/docs/evidence/program-table-simplification/task-2-prepare-server-rehearsal.md)에 있다.

## 실행한 도구와 후보

- 공식 `deploy/jenkins/program-migration/rehearse.sh`: `d13bf30db9bd7c1900ef20fba515e58f3f661402`
- prepare 소스: `92f2bff157d5691ea53ff891fa1e6a54a56c0065`
- prepare SQL SHA-256: `a381db6f234a508f45f6478f4cbec54e4046795fae3e52764bb363a8e1340c0a`
- retire 소스: `c706355d1e7de81258708a4ef77eaa99b09a3681`
- retire SQL SHA-256: `e83390b7d6cc95c20a37b79515cc161beb706b97f9dd37d749f633a7c6102fb8`

서버 안에서만 읽기 전용 pg_dump를 만들었다. 0700 디렉터리와 0600 덤프를 확인했다. 실제 덤프는 3,634,590 bytes이고 여유 공간 58,267,598,848 bytes는 3배 기준 10,903,770 bytes보다 컸다.

운영과 동일한 PostgreSQL 17 이미지를 사용했다. 임시 컨테이너의 network none, published ports 0, 요구된 rehearsal label, CPU 0.5, 메모리·swap 합계 512MiB, nice 19를 실제 값으로 확인했다. 앱 네트워크나 운영 데이터 볼륨을 연결하지 않았다.

## 행 수 및 데이터 검증

prepare 이후 옛 id를 보내지 않는 TeamMember INSERT 1건을 COMMIT했다. 이 검증 행이 retire 이후에도 남아 있음을 확인한 뒤 제거했다.

| 테이블 | 최초 | prepare + 검증 행 | retire 후 | 검증 행 제거 후 |
| --- | ---: | ---: | ---: | ---: |
| Program | 10 | 10 | 10 | 10 |
| Milestone | 20 | 20 | 20 | 20 |
| SubmissionFile | 81 | 81 | 81 | 81 |
| MilestoneDocumentTemplateFile | 5 | 5 | 5 | 5 |
| Team | 40 | 40 | 40 | 40 |
| TeamMember | 72 | 73 | 73 | 72 |
| TeamInvitation | 28 | 28 | 28 | 28 |

- 모든 단계에서 의도한 검증 행 이외의 행 수 불일치: **0**.
- 초대 28건의 원래 invitedAt과 보존한 createdAt 불일치: prepare/retire 모두 **0**.
- retire 이후 PK: **(teamId, userId)**. 옛 여섯 컬럼 잔여: **0**.
- 복원 DB에서 중복 storageKey INSERT가 `SubmissionFile_storageKey_key`의 unique violation으로 거부됨.
- 공식 도구가 retire 직전 백업을 또 다른 임시 DB에 복원했고, 7개 테이블 모두 백업 전/복원 후 행 수가 같았음. TeamMember는 검증 행을 포함하여 **73 / 73**.

초기 두 시도는 후보 SQL 전에 계측 함수 구문 오류로 중단됐다. 실패 시에도 정리되었고, 합성 DB에서 계측 SQL을 고친 뒤 최종 실행을 통과했다. 후보 마이그레이션은 수정하지 않았다.

## 요청된 통합 테스트

`apps/backend`에서:

```sh
BACKEND_INTEGRATION_TEST_PATTERN='(schema-invariants|team-invitations.integration|program-teams.integration)' bash test/run-integration.sh
```

```text
Test Suites: 3 passed, 3 total
Tests:       16 passed, 16 total
EXIT=0
```

## 서버 정리 영수증

```json
{"check":"official_rehearsal","EXIT":0}
{"check":"server_cleanup","owned_containers_remaining":0,"private_dirs_remaining":0,"dump_files_remaining":0,"ownership_error":0,"EXIT":0}
{"check":"independent_server_cleanup","runs_checked":3,"owned_containers_remaining":0,"private_dirs_remaining":0,"rollback_secret_still_present":1}
```

별도 SSH 정리 확인도 `EXIT=0`이다. 원본 덤프, 리허설 백업, 임시 DB 데이터는 서버 안에서 모두 제거했다. 개인별 행이나 secret 값은 로그·공개 증거에 출력하지 않았다.

## 롤백 secret 주의

현재 운영 backend에 non-empty `TEAM_JOIN_CODE_SECRET`이 있고 활성 compose에 전달 항목이 있으며, 마지막 확인에도 유지됐다. 값을 변경하지 않았다.

다만 #1718은 **후보 compose의 전달 항목과 필수 검증을 삭제한다**. 운영 환경 credential 자체를 변경하는 코드는 없지만, 이전 compose를 사용하는 롤백을 위해 credential의 값은 계속 보존해야 한다. 원본 credential 내용을 조회했다고 주장하지 않는다. 이번 커밋은 이 사실을 포함한 증거만 추가하며 제품 코드를 수정하지 않는다.

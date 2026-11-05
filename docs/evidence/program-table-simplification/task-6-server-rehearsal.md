# Todo 6 File 통합 서버 리허설

결론: 옛 SQL은 운영 덤프로, 현재 SQL은 로컬 합성 데이터로 리허설했다.
현재 SQL을 운영 덤프로 리허설한 적은 없으므로 배포 전에 다시 실행해야 한다.

## 현재 SQL의 로컬 합성 리허설

대상은 릴리스 순서대로 적용되는 세 마이그레이션이다.

| 마이그레이션 | 릴리스 | sha256 |
| --- | --- | --- |
| `20261105110000_retire_application_storage` | R2, #1754 | `174a94c2267f19ab9d28533b8783763a3c2f725615fb9c747d54174272245722` |
| `20261105200000_unify_files` | R2, 이 1단계 | `b5218a3ac3d34a4ef0a564f4d7e793fe364f90b92562bfeea9ae0e5d6eda1cbd` |
| `20261105225000_retire_file_tables` | R3, 2단계 | `837652646e270fa619ef8c4cf27e84093b06313e305e58014868082f4a3423aa` |

코드 head는 1단계 `7f2341166`(#1754 `28d7ced7b`와 main `2039af172` 포함)과 그 위에 2단계를 병합한 로컬 트리였고, 두 worktree 모두 깨끗했다.
그 뒤 두 단계에 들어온 변경은 통합 테스트 fixture와 문서, 그리고 2단계 마이그레이션의 디렉터리 이름뿐이다.
리허설 때 이름은 `20261105210000_retire_file_tables`였고, R2 뒤로 정렬되도록 `20261105225000`으로 옮겼다.
위 세 해시와 `team-application/retire.json`, `files/prepare.json`은 PR head에서도 같고, `files/retire.json`은 적용 경로의 디렉터리 이름만 다르다.
입력은 운영 데이터가 아니라 합성 시드다. Todo 9 리허설 시드를 실제 마이그레이션 체인으로
`20261105100100_merge_applications_into_teams`까지 올린 뒤, 그 시드에 없는 파일 원본 행을 더해 덤프를 만들었다.
모든 경로는 이 덤프에서 시작한다. 건수만 R1 뒤 운영에 맞췄다(Application 33, 파일 원본 81, 3, 5, 3, 2).
컨테이너는 `postgres:17-alpine`이고, 끝난 뒤 두 컨테이너가 지워진 것을 확인했다.
Todo 10 1단계는 이 순서에 들어 있지 않다.

정상 경로:

| 단계 | 결과 | 백업 복원 건수 대조 |
| --- | --- | --- |
| R1 뒤 덤프에 #1754 `team-application/retire.json` | exit 0, `REHEARSAL_OK stages=1 counts=14` | Application 33, ApplicationReviewHistory 9, SubmissionFile 81을 포함한 14개 모두 일치 |
| #1754를 실제로 적용한 덤프에 1단계 `files/prepare.json` | exit 0, `REHEARSAL_OK stages=1 counts=6` | SubmissionFile 81, ProgramAuthoringUpload 3, MilestoneDocumentTemplateFile 5, ProgramCover 3, ProgramPurgeFileTombstone 2, Program 3 모두 일치 |
| R1 뒤 덤프에 `prisma migrate deploy` 한 번 | exit 0, 두 마이그레이션 적용, head `20261105200000_unify_files`, File 92, Application 없음, `SubmissionFile.applicationId` 없음, `files/check-copy.sql` 불일치 0 | 해당 없음 |
| 그 결과의 덤프에 2단계 `files/retire.json` | exit 0, `REHEARSAL_OK stages=1 counts=2` | File 92, Program 3 모두 일치 |

`files/prepare.json`의 시작 head를 `20261105110000_retire_application_storage`로 옮긴 값과,
`SubmissionFile.applicationId`가 사라진 뒤 파일 원본의 바깥 FK를 12개로 세는 분기는 이 실행에서 처음 돌았다.

건수가 어긋날 때의 중단 경로(결함은 복사본에만 넣었다):

| 넣은 결함 | 실행 | 결과 |
| --- | --- | --- |
| #1754 뒤 1단계 전 Tombstone 1건 삭제 | `prepare.json` | exit 1, 적용 전 `FAIL_CLOSED preflight failed` |
| 복사 뒤 File 1건 삭제 | `prepare.json` | exit 1, `FAIL_CLOSED reconcile failed: copy` |
| 복원본의 Program 건수만 1 증가 | `prepare.json` | exit 1, `FAIL_CLOSED restored counts differ: 1` |
| 2단계 전 File 1건 삭제 | `retire.json` | exit 1, 적용 전 `FAIL_CLOSED preflight failed` |
| 2단계 전 Tombstone 1건 삭제 | `retire.json` | exit 1, 적용 전 `FAIL_CLOSED preflight failed` |

실제 `prisma migrate deploy`의 중단 경로:

| 넣은 결함 | Postgres 로그의 원인 | 중단 뒤 상태 |
| --- | --- | --- |
| R1 뒤 덤프에서 Tombstone 1건 삭제 | `file source count mismatch: {81,3,5,3,1}` | exit 1, `20261105110000_retire_application_storage`는 끝난 상태, Application 없음, File 테이블 없음, 파일 원본 다섯 그대로, `program_team_backup.application_team_map` 33, 다음 deploy P3009 |
| 2단계 전 Tombstone 1건 삭제 | `file retire aborted: source count mismatch: {81,3,5,3,1}` | exit 1, 원본 테이블 다섯과 File 92 그대로, 다음 deploy P3009 |
| 2단계 전 File 1건 삭제 | `file retire aborted: 1 source storage keys are missing from File` | exit 1, 원본 테이블 다섯과 File 91 그대로, 다음 deploy P3009 |

운영자가 알아야 할 점이 셋 있다.

- R2의 `migrate deploy`는 두 마이그레이션을 따로 커밋한다. 파일 guard가 멈추면 #1754의 Application 삭제는 이미 커밋되어 있고, 첫 줄이 그 상태를 재현한 것이다. 실패한 마이그레이션 하나만 되돌린다고 R1 상태로 돌아가지 않는다.
- SQL이 `BEGIN`과 `COMMIT`을 직접 쓰므로 Prisma 출력에는 `current transaction is aborted`만 보이고 진짜 원인은 Postgres 로그에 있다.
- 중단 뒤 `_prisma_migrations` 행은 `finished=false rolled_back=false`로 남아 다음 deploy가 P3009로 멈춘다. 이 상태는 `migrate resolve`로 풀지 말고 소유자에게 묻는다.

## 옛 SQL의 서버 내부 리허설

아래는 현재 SQL이 아니라 아래 표의 해시에 대한 기록이다.

2026-11-05 운영 서버 내부의 격리 복원본에서 두 단계 SQL을 실행했다.
운영 DB에는 읽기 전용 조회와 `pg_dump`만 사용했다. 실제 운영 마이그레이션,
스토리지 객체 삭제, Jenkins 실행, 배포 또는 머지는 수행하지 않았다.

### 검증한 입력

| 입력 | SHA-256 |
| --- | --- |
| `20261105200000_unify_files/migration.sql` | `ea3f1b795ca190f5adccd58364910ad5db6bb24c0aa9b8db854a3c639d88b647` |
| 후속 retire SQL | `4a040eacb58fb3a5bb1836aba2c9635e9302126a1182715e48ca2cd5f794bca1` |

운영 migration head는 `20261105050000_retire_submission_axis`였다.
복사와 물리 삭제를 각각 적용한 뒤 대조 스크립트의 불일치는 모두 0이었다.
이 절은 위 해시의 검증 결과다. 그 뒤 두 SQL 파일이 바뀌었다.

### 격리와 복구

- 운영 DB 크기 20,657,843 bytes, 실행 전 디스크 여유 60,388,216,832 bytes,
  가용 메모리 11,576,500,224 bytes를 확인했다.
- 운영과 같은 PostgreSQL 이미지를 사용했다. 새 컨테이너는 network `none`,
  published ports 0, CPU 0.5, memory와 memory+swap 각각 512 MiB,
  데이터 디렉터리 tmpfs 384 MiB, nice 19로 제한했다.
- `oss-hub.program-migration.rehearsal=true` label을 적용했다.
  덤프와 복원 데이터는 서버 밖으로 전송하지 않았다.
- 공식 `deploy/jenkins/program-migration/rehearse.sh`로 복사, 대조,
  retire 직전 백업, 물리 삭제, 재대조, 백업 복원을 순서대로 실행했다.
- 스토리지 객체는 이 SQL의 변경 대상이 아니다. 백업의 object-count 0은
  스토리지 바이트 백업을 수행했다는 뜻이 아니다. 아래 File 건수는 DB 행 수다.

### 행 대조

두 업로드 행은 이미 같은 storageKey의 양식 메타데이터와 짝이므로,
94개 원본 행을 92개 파일로 합치면서 업로드 SHA-256을 보존한다.

| 대상 | retire 직전 | 백업 복원 후 |
| --- | ---: | ---: |
| SubmissionFile | 81 | 81 |
| ProgramAuthoringUpload | 3 | 3 |
| MilestoneDocumentTemplateFile | 5 | 5 |
| ProgramCover | 3 | 3 |
| ProgramPurgeFileTombstone | 2 | 2 |
| File | 92 | 92 |
| Program | 10 | 10 |

첫 릴리스에는 원본 테이블을 보존하되 쓰기를 차단한다.
다음 릴리스의 retire는 원본 다섯 테이블 94행과 옛 lifecycle/source enum
네 개를 제거하고 File의 kind × lifecycle 및 Program 커버 CHECK를 적용한다.
원본 수, 복사 메타데이터, 예상 밖 incoming FK가 다르면 삭제 전에 중단한다.
통합된 File 92행과 Program 10행은 제거하지 않는다.

### 실행 영수증

```text
RECONCILE_OK stage=copy checks=1
RECONCILE_OK stage=retire checks=1
REHEARSAL_OK name=file-unification-two-release stages=2 counts=7
OFFICIAL_REHEARSAL_EXIT=0
CLEANUP containers=0 volumes=0 dump_files=0 private_dirs=0 EXIT=0
REHEARSAL_EXIT=0
```

임시 컨테이너, 익명 볼륨, 덤프, private 디렉터리는 모두 제거했다.
이 백업은 리허설 안에서 복원한 뒤 제거했으며 배포용 보존 백업이 아니다.
실제 전환 시에는 그 시점의 사전 점검과 보존 백업이 필요하다.
구 이미지로의 복귀 호환은 제공하지 않으며 복구는 백업 복원이다.

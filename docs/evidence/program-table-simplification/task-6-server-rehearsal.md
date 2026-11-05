# Todo 6 File 통합 서버 리허설

2026-11-05 운영 서버 내부의 격리 복원본에서 두 단계 SQL을 실행했다.
운영 DB에는 읽기 전용 조회와 `pg_dump`만 사용했다. 실제 운영 마이그레이션,
스토리지 객체 삭제, Jenkins 실행, 배포 또는 머지는 수행하지 않았다.

## 검증한 입력

| 입력 | SHA-256 |
| --- | --- |
| `20261105200000_unify_files/migration.sql` | `ea3f1b795ca190f5adccd58364910ad5db6bb24c0aa9b8db854a3c639d88b647` |
| 후속 retire SQL | `4a040eacb58fb3a5bb1836aba2c9635e9302126a1182715e48ca2cd5f794bca1` |

운영 migration head는 `20261105050000_retire_submission_axis`였다.
복사와 물리 삭제를 각각 적용한 뒤 대조 스크립트의 불일치는 모두 0이었다.
이 문서는 위 해시의 검증 결과다. 앞선 리허설 이후 SQL이 변경되어
같은 절차를 현재 SQL로 다시 실행했다.

## 격리와 복구

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

## 행 대조

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

## 최종 실행 영수증

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

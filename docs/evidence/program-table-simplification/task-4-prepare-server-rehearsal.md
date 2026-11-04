# Todo 4 준비 이관의 서버 내부 복원 리허설

2026-11-04 운영 DB의 읽기 전용 덤프를 같은 서버 안의 임시 PostgreSQL에
복원했다. 운영 DB 쓰기, 배포, Jenkins 실행은 하지 않았다.

## 입력과 결과

- 운영 완료 migration head: `20261103140000_retire_program_dead_columns`.
- 후보 SQL: `20261104060000_prepare_submission_axis/migration.sql`.
- SQL SHA-256: `a2d30e6a393f714740e23881a44eaa7710296908aba8e3a92b671b651ebe2c35`.
- 실행 도구: 저장소의 `deploy/jenkins/program-migration/rehearse.sh`.
- manifest: `submission-axis/prepare.json`.
- DB 크기 20,543,155 bytes, 덤프 3,631,330 bytes, 작업 공간 가용량
  8,226,611,200 bytes. 덤프 모드 0600, 상위 작업 디렉터리 0700.
- 원본 심사 16건 중 nonnull 재제출 기한은 0건이었다. 기한 컬럼을
  SubmissionHistory로 옮기지 않았으며 원본 심사 코멘트는 보존했다.

운영과 같은 PostgreSQL 이미지로 network none, 공개 포트 0, CPU 0.5,
메모리와 memory+swap 각 512 MiB를 설정했다. 데이터 디렉터리는 384 MiB
tmpfs이고 `--rm`을 사용했다. nice 19로 PostgreSQL을 시작했다.
운영 데이터 볼륨과 앱 네트워크는 연결하지 않았다.

공식 도구의 원본 복원, 사전 점검, 준비 직전 백업, 준비 SQL 적용,
정합성 검사, 백업 재복원이 모두 성공했다. 사전 점검과 준비 후 대조의
불일치는 모두 0이었다. 공개 ID 20건, 레거시 항목 6건, 유형만 있던
마일스톤 2건과 심사 ID·코멘트 보존은 같은 대조 SQL로 검사했다.

| 백업 대상 | 준비 전 | 백업 재복원 |
| --- | ---: | ---: |
| 제출 | 55 | 55 |
| 제출 이력 | 94 | 94 |
| 원본 심사 | 16 | 16 |
| 제출 파일 | 81 | 81 |
| 제출 항목 | 23 | 23 |

이 표는 준비 직전 백업의 복원 대조다. 준비 후에는 누락된 필수 항목 2개가
추가되므로 준비 후 항목 수가 그대로라는 뜻이 아니다. 준비 단계에서 삭제한
테이블·컬럼·행은 없다.

```text
CHECK_OK check-before.sql
CHECK_OK check-prepare.sql
REHEARSAL_OK name=submission-axis-prepare stages=1 counts=5
OFFICIAL_REHEARSAL_EXIT=0
SERVER_REHEARSAL_EXIT=0
```

## 실패 경로와 정리

첫 실행은 후보 SQL 적용 전에 컨테이너의 BusyBox `ps`가 `ni` 컬럼을
지원하지 않아 종료했다. 지원되는 `nice` 컬럼으로 계측만 수정했다.
실패한 실행에서도 컨테이너와 덤프, 작업 디렉터리를 제거했다.

성공 실행의 종료 처리와 별도 SSH 연결의 확인:

```text
CLEANUP containers_remaining=0 dump_remaining=0 anonymous_volumes_created=0 EXIT=0
PRIVATE_DIR_CLEANUP remaining=0 EXIT=0
INDEPENDENT_CLEANUP containers=0 known_private_dir=0 EXIT=0
CLEANUP_CHECK_EXIT=0
```

덤프와 리허설 내부 백업은 모두 제거했다. 데이터는 서버 밖으로 옮기지
않았다. 이 결과는 운영 배포 완료나 영구 백업 보존을 뜻하지 않는다.

# Todo 5 운영 집계와 서버 내부 리허설

2026-11-04, 운영 DB에는 읽기 전용 집계와 `pg_dump`만 실행했다. 덤프와 복원 데이터는 서버를 벗어나지 않았다. 아래는 최종 CHECK와 앱 교체 전 옛 퍼지의 FK 해제 호환을 함께 반영한 SQL로 다시 실행한 결과다.

| 최종 입력 | SHA-256 |
| --- | --- |
| prepare SQL | `525ab8522b64a26a48ad637edb7e394114bbf62033f9de5f062db07e7454bb6f` |
| retire SQL | `637fe6e3f28f593cdebf8afdb12568a6e31004a3c9fbb4963efe2c48601a4bf7` |

## 운영 집계

`transaction_read_only=on`, `EXIT=0`.

| 항목 | 건수 |
| --- | ---: |
| Program | 10 |
| ProgramCreateRequest | 9 |
| 요청 행이 없어 LEGACY_UNKNOWN으로 남는 Program | 1 |
| ProgramAuthoringUpload | 3 |
| ATTACHED 업로드 | 2 |
| 미완료 마이그레이션 | 0 |

마지막 적용 마이그레이션은 `20261103140000_retire_program_dead_columns`였다. 첫 집계 명령은 컨테이너 안의 사용자 환경 변수를 잘못 인용해 접속 전에 실패했다(`EXIT=2`). 인용을 고친 두 번째 실행만 위 결과의 근거다.

## 공식 도구 리허설

`deploy/jenkins/program-migration/rehearse.sh`로 baseline, prepare, retire를 순차 실행했다. prepare 전에 공식 백업을 만들고 SHA-256 영수증을 확인했다. 마지막에 그 백업을 다른 임시 DB로 복원해 건수를 대조했다.

- 시작 시 디스크 여유: 8,226,611,200 bytes.
- 원본 DB 크기: 20,543,155 bytes. SQL 덤프: 3,640,005 bytes.
- 임시 컨테이너: 운영 PostgreSQL 이미지 재사용, network none, 공개 포트 0, CPU 0.5, 메모리와 memory+swap 512MiB. 호스트 리허설 명령은 nice 19로 실행했다.
- `oss-hub.program-migration.rehearsal=true` label 확인.
- 사전 점검 0, 생성 사실·업로드 연결 대조 0, 원본 행 JSON digest 대조 0, retire 대조 0.

| 백업 전/복원 후 | 전 | 후 |
| --- | ---: | ---: |
| Program | 10 | 10 |
| 생성 요청 | 9 | 9 |
| 업로드 | 3 | 3 |
| 팀·팀원·지원·마일스톤·제출·제출 이력·심사 이력 합계 | 330 | 330 |

```text
REHEARSAL_OK name=program-absorption stages=3 counts=4
CLEANUP containers=0 directories=0 EXIT=0
REHEARSAL_BRIDGE_EXIT=0
```

덤프와 리허설 백업, 임시 DB, 컨테이너, private 디렉터리를 제거했다. 이 백업을 배포용 보존 백업이라고 주장하지 않는다. 실제 후속 삭제 배포 전에는 다시 백업·대조하고 소유자 승인을 받아야 한다.

후속 정리 감사에서 wrapper가 `docker rm -f`만 사용해 익명 볼륨 세 개를 남긴 것을 발견했다. 세 볼륨의 PostgreSQL 카탈로그에 이 작업 로그의 고유 리허설 DB 이름이 남아 있어 소유권을 대조했다. 정확한 세 이름만 지정해 제거했으며 prune은 실행하지 않았다. wrapper는 `--rm`과 `docker rm -fv`로 수정했다. 별도 제거·잔여 확인 영수증은 완료 보고에 포함한다.

```json
{"removed_owned_volumes":3,"owned_remaining":[],"august_all_retained":44,"august_dangling_retained":43,"EXIT":0}
```

최초 잔여 확인은 8월의 전체 볼륨과 dangling 볼륨을 혼동해 44를 43과 비교했다. 재확인은 두 범위를 구분했다. 추가 삭제 없이 이 작업의 볼륨 0개와 기존 dangling 볼륨 43개 보존을 확인했다.

## 릴리스 순서와 비가역 값

먼저 prepare 앱을 배포한다. 이 앱은 ProgramCreateRequest와 옛 업로드 FK 컬럼을 읽거나 기록하지 않는다. 이후 별도 릴리스에서만 retire를 적용한다. 두 PR을 같은 배포에 넣지 않는다.

현재 집계 기준 retire의 물리 삭제 대상은 요청 9행과 옛 업로드 FK 2개 컬럼이다. 생성자·멱등 키·해시는 Program으로, 연결 대상은 업로드의 programId로 이미 이관되어야 한다. 원래 요청의 대리키 9개와 요청 시각 9개는 최종 모델에 남지 않는다. 옛 업로드 FK scalar 값은 합계 4개이며 programId와 Program 생성자로 대체된다. 프로그램과 하위 도메인 행의 삭제는 0건이다.

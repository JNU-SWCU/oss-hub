# 프로그램 이관 점검

단계 PR과 단일 PR이 함께 쓰는 사전 점검, 대조, 백업, 리허설 스크립트입니다.
모든 명령은 `PM_PG_CONTAINER`로 받은 Postgres 컨테이너 안에서 `docker exec`로 실행하므로 비밀번호를 받지 않습니다.
대상 DB는 기본적으로 컨테이너의 `POSTGRES_DB`이고, `PM_DATABASE`로 바꿀 수 있습니다.

| 스크립트 | 용도 |
| --- | --- |
| `preflight.sh <manifest>` | 마이그레이션 원장 머리와 사전 점검 SQL 확인 |
| `reconcile.sh <manifest> <stage-id>` | 단계의 대조 SQL 실행 |
| `backup.sh --label L --backup-dir D [-- 객체 복사 명령]` | 덤프와 객체 복사, 해시, 영수증 생성 |
| `verify-backup.sh D L` | 영수증 기준으로 덤프와 객체 재검증 |
| `rehearse.sh <manifest>` | 격리 DB에서 전 과정 실행 |

## 점검 SQL 규칙

점검 파일은 읽기 전용으로 실행되고, 출력은 불일치 건수 정수 한 줄이어야 합니다.
`0`만 통과이며 빈 출력, 여러 줄, SQL 오류, 시간 초과는 모두 실패입니다.
`RAISE EXCEPTION` 방식을 쓰면 마지막에 `SELECT 0;`을 둡니다.
오류 메시지는 Jenkins 로그에 남으므로 `RAISE`에 행 값을 넣지 않습니다.

## 매니페스트

경로는 매니페스트 파일 기준 상대 경로이고, 모르는 키는 거부합니다.

```json
{
  "version": 1,
  "name": "file-unification",
  "expectedHeadMigration": "20261103000000_previous",
  "preflight": ["preflight.sql"],
  "stages": [
    { "id": "copy", "apply": ["copy.sql"], "reconcile": ["reconcile-copy.sql"] },
    { "id": "switch-read", "apply": [], "reconcile": ["reconcile-copy.sql"] },
    { "id": "drop-old", "apply": ["drop.sql"], "reconcile": ["reconcile-drop.sql"] }
  ],
  "cutover": {
    "afterStage": "switch-read",
    "write": ["write-after-cutover.sql"],
    "previousImageCheck": ["./check-previous-image.sh"],
    "oldStructureReconcile": ["reconcile-old.sql"]
  },
  "backupBeforeStage": "drop-old",
  "counts": [{ "name": "file-rows", "file": "count-files.sql" }],
  "objectMirror": ["./mirror-objects.sh"]
}
```

- `cutover`는 단계 PR에서만 씁니다. 단일 PR은 생략하고 `backupBeforeStage`를 첫 단계로 둡니다.
- `cutover`는 `backupBeforeStage`보다 앞 단계에 있어야 합니다.
- `previousImageCheck`는 `PM_PG_CONTAINER`, `PM_DATABASE` 환경 변수를 받습니다.
- `objectMirror`와 `backup.sh`의 객체 복사 명령은 마지막 인자로 저장 디렉터리를 받습니다.
- 두 명령의 출력은 비밀 노출을 막기 위해 버립니다. 진단이 필요하면 명령이 직접 비공개 위치에 기록합니다.

## 리허설

`rehearse.sh`는 `oss-hub.program-migration.rehearsal=true` 라벨이 있는 컨테이너에서만 돌고, `PM_DUMP_FILE`의 덤프를 복원합니다.
덤프의 소유자 역할이 있도록 컨테이너의 `POSTGRES_USER`를 운영과 같게 맞춥니다.
흐름은 복원, 사전 점검, 단계별 적용과 대조, 전환 후 쓰기, 이전 이미지 확인과 옛 구조 대조, 삭제 전 건수 기록과 백업, 삭제, 백업 복원 후 건수 대조입니다.

운영 `backup.sh`는 `prune-deploy-backups.sh`가 관리하는 `BACKUP_DIR`이 아니라 전용 디렉터리에 저장합니다.

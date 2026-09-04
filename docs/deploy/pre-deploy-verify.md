# 배포 전 단계 검증 (pre-deploy verification)

첫 GitHub Release 배포 전에 **로컬 랩탑 → 배포 EC2 서버-로컬 드라이런** 순서로 단계 검증한다.
앞 단계가 통과해야 다음으로 넘어간다. 목적은 회귀 위험(첫 배포는 `PREV_TAG`가 없어 자동 rollback 불가)을 사전 차단하는 것이다.
서버 접속·설치·job 절차는 [server-runbook](./server-runbook.md)이 원본이며, 이 문서는 검증 절차만 다룬다.

프로덕션 스택 정의는 저장소 루트 `compose.yml`(nginx / backend / postgres)이 원본이다. Local frontend·MinIO substitute는 `compose.local.yml`에서만 추가된다.
Compose nginx는 `127.0.0.1:8081`에만 bind한다. 공인 `80/443`은 host nginx 계약이다.

## 표기 규약

- 아래 로컬 검증용 env는 **비시크릿 예시**다. 실제 운영 값은 이 저장소에 두지 않는다(운영 값은 배포 서버 `.env` / Jenkins Credentials Store).
- **release 발행 전 확인:** Jenkins `oss-hub-production-env` credential에 `AUTH_INITIAL_ROLES`가 있는지 본다. `compose.yml`이 `${AUTH_INITIAL_ROLES:-}`로 선택 매핑하므로 **키가 없어도 배포는 성공하지만 초기 역할 시드가 조용히 꺼진다.** 시드를 쓰지 않기로 했다면 그 결정을 release 노트에 남긴다. 값을 넣는다면 형식(`githubId:ROLE` 쉼표 구분, ROLE은 `ADMIN|STAFF|STUDENT`)을 먼저 확인한다 — **형식이 잘못되면 backend가 부팅하지 못해 배포 검증이 실패한다.** 숫자가 아닌 id, `0`, 알 수 없는 역할, 중복 githubId가 대표적인 실패 입력이다.
- `<...>`, `REPLACE_*` 자리표시자는 로컬에서 각자 채운다.

## ⓪ 파괴적 이관 리허설

릴리스 diff의 `apps/backend/prisma/migrations/**`에 `DROP TABLE`·`DROP COLUMN`·`DROP CONSTRAINT`가 있으면 **이 릴리스를 내보내기 전에** 리허설을 돌린다.
Prisma에는 down 마이그레이션이 없고 배포 경로에 자동 DB 복원도 없다 — 파괴적 DDL이 커밋된 뒤에는 되돌릴 자동 수단이 없다.
로컬·E2E·CI는 매번 빈 데이터베이스에 마이그레이션을 적용하므로, 데이터가 있는 DB에서 그 이관이 도는 것은 리허설이 유일하다.

legacy-submission 3단 이관(expand → bridge → contract, 2026-08-30)의 리허설은 다음 두 명령이다.
각각 일회용 PostgreSQL 컨테이너를 스스로 띄우고 끝나면 지운다.
호출자의 `DATABASE_URL`을 읽지 않으므로 운영·개발 DB에 붙을 경로가 없다.

```sh
bash scripts/rehearse-legacy-submission-migrations.sh migrate
bash scripts/rehearse-legacy-submission-migrations.sh negative
```

출력은 마지막 한 줄의 JSON으로 읽는다.

- `{"status":"ok","scenario":"migrate",...}` — seed를 채운 DB에서 세 단계가 통과했고, 이관 전후의 행 수와 id 매핑이 같았으며, 파괴적 DDL 직전 백업으로 원본 세 테이블이 되살아났다는 뜻이다(`submissions`·`revisions`·`reviews`·`files`는 대조한 원본 행 수다).
- `{"status":"ok","scenario":"negative","lanes":9}` — contract의 preflight 게이트 아홉 개가 각각 자기 위반 데이터에서 멈췄고, 멈춘 뒤에도 원본 세 테이블과 `SubmissionFile."submissionRevisionId"`가 남아 있었다는 뜻이다.
- 그 밖의 출력은 전부 실패다 — `... drifted`는 매핑이 갈라진 것이고 `... accepted ...`는 걸려야 할 데이터를 게이트가 통과시킨 것이며, **어느 쪽이든 릴리스를 내보내지 않는다.**

다음 파괴적 이관도 같은 두 겹을 갖춘다 — 컨테이너 리허설 스크립트 하나와, 그 스크립트의 정적 계약을 required CI에 고정하는 `scripts/*.test.mjs` 하나다.
컨테이너 리허설 자체는 PostgreSQL 기동이 필요해 required CI가 아니라 이 단계에서 손으로 돈다([ci-path-verification](../rules/ci-path-verification.md)).

### 이관이 실패했을 때 복구할 것

배포 중 `prisma migrate deploy`가 멈춘 경우, 먼저 **어디에서 멈췄는지**를 가른다.

1. preflight 게이트가 걸린 경우(로그에 `... requires reconciliation`).
   마이그레이션 파일 전체가 하나의 `BEGIN`/`COMMIT`이므로 데이터베이스는 **아무것도 바뀌지 않은 상태**이고 복원할 데이터가 없다.
   남는 것은 `_prisma_migrations`의 실패 기록 하나뿐이고, 이것을 되돌리지 않으면 이후 배포가 거부된다 — [server-runbook](./server-runbook.md) M11의 `prisma migrate resolve --rolled-back` 절차를 해당 마이그레이션 이름으로 그대로 쓴다.
   게이트가 가리킨 데이터를 먼저 정리한 뒤 다시 배포한다.
2. 게이트를 통과한 뒤 깨진 경우.
   이때는 파괴적 DDL이 이미 커밋됐을 수 있다.
   되돌릴 근거는 [server-runbook](./server-runbook.md) M3의 배포 백업뿐이므로 그 덤프에서 복원한다.
   복원 후에는 이관이 지운 것이 실제로 돌아왔는지 확인한다 — legacy-submission 이관이라면 `Submission`·`SubmissionRevision`·`Review` 세 테이블과 `SubmissionFile."submissionRevisionId"` 칸이다.
   복원 뒤에도 `_prisma_migrations` 정리는 1과 같다.

## ① 로컬 랩탑 검증

로컬 통합 검증은 production Compose를 수동 변형하지 않고 저장소가 소유한 두 파일 계약을 그대로 사용한다.

1. `.env.example`을 기준으로 추적하지 않는 `.env`를 준비한다. Local frontend·MinIO 값은 합성 개발 값만 사용하고 운영 credential을 복사하지 않는다.
2. `pnpm local:verify`를 실행한다. 이 명령은 `compose.yml + compose.local.yml`로 backend·frontend를 현재 source에서 build하고 PostgreSQL·MinIO·local nginx를 기동한 뒤 migration, root/frontend, API health와 object-store lifecycle을 확인한다.
3. Root는 local frontend 200, `/api/v1/health`는 PostgreSQL을 포함한 200이어야 한다. 제출 파일 미인증 `POST /api/v1/submission-files`는 401이어야 한다.
4. 실패 로그는 `pnpm local:up`과 같은 고정 project/two-file boundary 안에서 확인한다. 운영 프로젝트나 volume을 조작하지 않는다.
5. 정리는 `pnpm local:down`만 사용한다. 이 명령의 `down -v`는 격리된 local project에만 허용되며 production에서는 금지한다.

세부 포트·OAuth origin·host hot reload 선택은 [local-dev](../rules/local-dev.md)가 원본이다.

## ② 배포 서버 검증

로컬 검증이 통과한 뒤 docker 권한이 있는 운영 세션에서 현재 상태를 읽기 전용으로 확인한다.

```sh
container_id="$(docker ps -q \
  --filter label=com.docker.compose.project=oss-hub \
  --filter label=com.docker.compose.service=backend)"
test -n "$container_id"
docker inspect --format \
  'image={{.Config.Image}} version={{index .Config.Labels "org.opencontainers.image.version"}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} restart={{.RestartCount}} health={{.State.Health.Status}}' \
  "$container_id"

require_status() {
  actual="$(curl -s -o /dev/null -w '%{http_code}' \
    -H 'Host: jnu-oss-hub.com' \
    -H 'X-Vercel-Forwarded-For: 192.0.2.1' \
    --request "$2" "$3")"
  test "$actual" = "$1" || { printf 'FAIL %s %s expected=%s actual=%s\n' "$2" "$3" "$1" "$actual" >&2; return 1; }
}
require_status 404 GET  http://127.0.0.1:8081/
require_status 200 GET  http://127.0.0.1:8081/api/v1/health
require_status 404 GET  http://127.0.0.1:8081/api/v1/submission-files
require_status 401 POST http://127.0.0.1:8081/api/v1/submission-files
require_status 404 GET  http://127.0.0.1:8081/api/v1/Submission-Files
require_status 401 POST http://127.0.0.1:8081/api/v1/Submission-Files
require_status 401 GET  http://127.0.0.1:8081/api/v1/submission-files/1
```

- Backend는 running·healthy, restart 0, 대상 Release version과 exact revision을 보고해야 한다.
- Loopback probe의 reserved synthetic client header는 authenticated host nginx 뒤의 Compose contract를 재현한다. Loopback root 404는 production Compose가 browser frontend를 제공하지 않는다는 계약이고 `/api/v1/health` 200은 PostgreSQL 연결까지 확인한다.
- 미인증 POST 401은 요청이 nginx를 통과해 backend `SessionGuard`에 도달했음을 증명한다.
- 이 검증은 컨테이너·volume·image를 변경하지 않는다. Production에서 `down -v`를 사용하지 않는다.
- Docker 권한이 없으면 Jenkins build의 exact Release/Image ID receipt를 사용하고, process 시작 시각만으로 OCI identity를 증명했다고 기록하지 않는다.

## ③ 다음 단계

⓪①②가 모두 통과한 뒤에만 [server-runbook](./server-runbook.md) M7의 parameterless Release 배포 또는 no-op 재실행으로 넘어간다.
자동 트리거 계약은 [ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)가 원본이다.

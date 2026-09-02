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

①②가 모두 통과한 뒤에만 [server-runbook](./server-runbook.md) M7의 parameterless Release 배포 또는 no-op 재실행으로 넘어간다.
자동 트리거 계약은 [ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)가 원본이다.

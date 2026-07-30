# 배포 전 단계 검증 (pre-deploy verification)

첫 GitHub Release 배포 전에 **로컬 랩탑 → 배포 EC2 서버-로컬 드라이런** 순서로 단계 검증한다.
앞 단계가 통과해야 다음으로 넘어간다. 목적은 회귀 위험(첫 배포는 `PREV_TAG`가 없어 자동 rollback 불가)을 사전 차단하는 것이다.
서버 접속·설치·job 절차는 [server-runbook](./server-runbook.md)이 원본이며, 이 문서는 검증 절차만 다룬다.

프로덕션 스택 정의는 저장소 루트 `compose.yml`(nginx / frontend / backend / postgres)이 원본이다.
Compose nginx는 `127.0.0.1:8081`에만 bind한다. 공인 `80/443`은 host nginx 계약([init-operations](../exec-plan/active/init-operations.md) M4)이다.

## 표기 규약

- 아래 로컬 검증용 env는 **비시크릿 예시**다. 실제 운영 값은 이 저장소에 두지 않는다(운영 값은 배포 서버 `.env` / Jenkins Credentials Store).
- **release 발행 전 확인:** Jenkins `oss-hub-production-env` credential에 `AUTH_INITIAL_ROLES`가 있는지 본다. `compose.yml`이 `${AUTH_INITIAL_ROLES:-}`로 선택 매핑하므로 **키가 없어도 배포는 성공하지만 초기 역할 시드가 조용히 꺼진다.** 시드를 쓰지 않기로 했다면 그 결정을 release 노트에 남긴다. 값을 넣는다면 형식(`githubId:ROLE` 쉼표 구분, ROLE은 `ADMIN|STAFF|STUDENT`)을 먼저 확인한다 — **형식이 잘못되면 backend가 부팅하지 못해 배포 검증이 실패한다.** 숫자가 아닌 id, `0`, 알 수 없는 역할, 중복 githubId가 대표적인 실패 입력이다.
- `<...>`, `REPLACE_*` 자리표시자는 로컬에서 각자 채운다.

## ① 로컬 랩탑 검증

내 개발 머신에서 프로덕션 `compose.yml`을 임시 태그·격리 프로젝트로 띄워 loopback Compose ingress의 `/`·`/api/v1/health` 200과 제출 파일 업로드 경로 403 smoke를 확인한다.
업로드 403은 `Jenkinsfile`의 rollout·rollback smoke가 단언하는 3종 중 하나이므로 이 단계에서도 함께 확인해야 검증 범위가 실제 배포 계약과 같아진다.
개발/운영 데이터와 섞이지 않도록 **격리 프로젝트명 `oss-hub-localverify`**를 쓴다.

### 로컬 검증용 env 템플릿 (비시크릿)

아래를 `oss-hub-localverify.env`처럼 **저장소 밖**(예: 홈 디렉터리)에 저장한다. `.env.*` 파일은 저장소에 커밋하지 않는다(public-safe 정책).
변수명은 저장소 루트 `.env.example`과 동일한 계약을 따른다. `compose.yml`이 강제하는 필수 키를 빠뜨리지 않는다.
`GITHUB_COLLECTION_APP_PRIVATE_KEY_SOURCE`와 `GITHUB_OPERATIONS_APP_PRIVATE_KEY_SOURCE`는 저장소 루트의 추적하지 않는 `secrets/` 아래 PEM 파일을 가리킨다. 로컬 검증 전에 그 파일들을 직접 배치해야 `docker compose config`와 `scripts/docker-verify-local.sh`가 통과한다.

```dotenv
# 로컬 검증 전용 — 비시크릿 예시. 저장소에 커밋하지 않는다.
IMAGE_TAG=localverify

# PostgreSQL (로컬 컨테이너 전용, 임의 로컬값)
POSTGRES_USER=oss
POSTGRES_PASSWORD=REPLACE_LOCAL_PW
POSTGRES_DB=osshub

# MinIO (compose.yml 필수. 로컬 컨테이너 전용 자격증명)
SUBMISSION_FILE_S3_ACCESS_KEY_ID=REPLACE_LOCAL_MINIO_ACCESS_KEY
SUBMISSION_FILE_S3_SECRET_ACCESS_KEY=REPLACE_LOCAL_MINIO_SECRET_KEY

# migration·runtime 공용. compose 네트워크의 postgres 서비스 DNS를 가리킨다.
# POSTGRES_PASSWORD와 같은 비밀번호를 쓴다.
DATABASE_URL=postgresql://oss:REPLACE_LOCAL_PW@postgres:5432/osshub

# 세션 서명 키 — base64url 32바이트 이상. 빈 값이면 운영 이미지 기동이 실패한다.
# 생성: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
# 아래는 길이만 맞춘 합성 예시(운영 재사용 금지). 로컬에서 새로 만들어 넣는다.
SESSION_SECRET=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA

# 팀 참여코드 HMAC 키 — compose.yml 필수. 운영 재사용 금지. 로컬에서 새로 만든다.
# 생성: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
TEAM_JOIN_CODE_SECRET=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB

# backend Dockerfile이 NODE_ENV=production이므로 HTTPS origin이 필수다.
# smoke URL(http://127.0.0.1:8081/)과 달라도 된다 — 이 값은 세션·OAuth origin 계약이다.
FRONTEND_URL=https://127.0.0.1

# 초기 역할 시드 — compose.yml이 ${AUTH_INITIAL_ROLES:-}로 선택 매핑한다.
# 형식: "githubId:ROLE" 쉼표 구분, ROLE은 ADMIN|STAFF|STUDENT.
# 로컬 검증에서는 비워도 된다(시드 미적용).
AUTH_INITIAL_ROLES=

# GitHub App 기본 식별자 — compose.yml 필수.
# 실제 운영 값 대신 로컬 검증용 자리표시자를 넣는다.
GITHUB_COLLECTION_APP_ID=REPLACE_LOCAL_COLLECTION_APP_ID
GITHUB_APP_ORG=REPLACE_LOCAL_GITHUB_ORG
GITHUB_OPERATIONS_APP_ID=REPLACE_LOCAL_OPERATIONS_APP_ID

# GitHub App 개인키는 값이 아니라 파일 경로다.
# 저장소 루트의 추적하지 않는 secrets/ 아래 PEM 파일을 직접 두고, _SOURCE는 그 호스트 경로를 가리킨다.
GITHUB_COLLECTION_APP_PRIVATE_KEY_SOURCE=./secrets/localverify/collection.pem
GITHUB_OPERATIONS_APP_PRIVATE_KEY_SOURCE=./secrets/localverify/operations.pem
# legacy fallback은 선택값이라 비워 둔다.
GITHUB_COLLECTION_APP_PRIVATE_KEY=
GITHUB_OPERATIONS_APP_PRIVATE_KEY=

# GitHub OAuth — 로컬 부팅용 형식만 맞춘 자리표시자.
# health 확인만 할 때는 형식상 값이면 되지만, backend가 부팅 시 검증하면
# 개발용 OAuth App의 값으로 대체한다.
GITHUB_OAUTH_CLIENT_ID=REPLACE_LOCAL_OAUTH_ID
GITHUB_OAUTH_CLIENT_SECRET=REPLACE_LOCAL_OAUTH_SECRET

# Gmail OAuth — production 이미지 부팅 계약(mail-sender.provider).
# smoke 전용 로컬 검증은 형식상 자리표시자면 충분하다. 실제 발송은 하지 않는다.
# compose.yml이 이 4종을 backend 컨테이너에 명시 전달한다.
GMAIL_SENDER=localverify@example.com
GMAIL_OAUTH_CLIENT_ID=REPLACE_LOCAL_GMAIL_CLIENT_ID
GMAIL_OAUTH_CLIENT_SECRET=REPLACE_LOCAL_GMAIL_CLIENT_SECRET
GMAIL_OAUTH_REFRESH_TOKEN=REPLACE_LOCAL_GMAIL_REFRESH_TOKEN

# 메일 전송 모드 — 로컬 검증은 발송하지 않으므로 dry-run을 쓴다.
MAIL_MODE=dry-run
```

### 실행

```sh
# 1) 이미지 로컬 빌드 (IMAGE_TAG=localverify)
docker build --file apps/frontend/Dockerfile --tag oss-hub-frontend:localverify .
docker build --file apps/backend/Dockerfile  --tag oss-hub-backend:localverify  .

# 2) 격리 프로젝트로 기동
COMPOSE_PROJECT_NAME=oss-hub-localverify \
  docker compose --env-file ~/oss-hub-localverify.env -f compose.yml up -d --wait --wait-timeout 120

# 3) smoke (loopback Compose ingress)
curl -fsS http://127.0.0.1:8081/            > /dev/null && echo "root OK"
curl -fsS http://127.0.0.1:8081/api/v1/health > /dev/null && echo "health OK"
# 업로드 차단은 성공 코드가 아니므로 -f 없이 상태 코드를 직접 읽는다.
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/api/v1/submission-files)" = '403' \
  && echo "upload 403 OK"
```

- 예상 출력: `root OK`, `health OK`, `upload 403 OK` (앞 두 요청은 HTTP 200, 업로드 경로는 HTTP 403).
- 업로드 경로가 403이 아니면 실행 중 nginx 설정에 fail-closed 차단이 없다는 뜻이므로 이 단계를 통과시키지 않는다.
- 검증: 실패 시 `COMPOSE_PROJECT_NAME=oss-hub-localverify docker compose --env-file ~/oss-hub-localverify.env -f compose.yml logs`로 원인을 본다. `IMAGE_TAG`·필수 env 미설정이면 compose가 즉시 실패한다(`compose.yml`이 `${VAR:?}`로 강제).

### 정리 (로컬 한정)

```sh
# 로컬 격리 스택만 볼륨까지 제거 — 이 격리 프로젝트에서만 down -v 허용
COMPOSE_PROJECT_NAME=oss-hub-localverify \
  docker compose --env-file ~/oss-hub-localverify.env -f compose.yml down -v
```

- **주의**: `down -v`는 **로컬 격리 프로젝트(`oss-hub-localverify`)에서만** 허용한다. 운영 서버에서는 절대 `down -v`를 쓰지 않는다(`pgdata` 보존).

## ② 배포 서버 검증

로컬 검증(①)이 통과한 뒤, [server-runbook](./server-runbook.md) M1의 대상 서버에서 현재 운영 상태를 읽기 전용으로 확인한다.

```sh
for service in frontend backend; do
  container_id="$(docker ps -q \
    --filter label=com.docker.compose.project=oss-hub \
    --filter label=com.docker.compose.service="$service")"
  test -n "$container_id"
  docker inspect --format \
    'image={{.Config.Image}} version={{index .Config.Labels "org.opencontainers.image.version"}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} restart={{.RestartCount}} health={{.State.Health.Status}}' \
    "$container_id"
done
curl -fsS http://127.0.0.1:8081/ > /dev/null
curl -fsS http://127.0.0.1:8081/api/v1/health
# 업로드 차단은 성공 코드가 아니므로 -f 없이 상태 코드를 직접 읽는다.
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/api/v1/submission-files  # 403
```

- 예상 결과: 두 서비스 모두 running·healthy, restart 0, 동일 SemVer version과 동일 40-hex revision을 보고하고 `/`·`/api/v1/health` smoke가 200, 제출 파일 업로드 경로가 403이다.
- `/api/v1/health` 200은 PostgreSQL 연결까지 확인한 결과다. DB에 닿지 못하면 503이므로 이 스텝이 DB 가용성 확인을 겸한다.
- 업로드 경로 403은 실행 중 nginx 설정의 fail-closed 차단이 살아 있다는 증거다 — 저장소 파일만 읽어서는 증명되지 않으므로 ingress를 직접 호출해 확인한다.
- 이 검증은 컨테이너·볼륨·이미지를 변경하지 않는다. 운영 서버에서 `down -v`를 사용하지 않는다.

## ③ 다음 단계

①②가 모두 통과한 뒤에만 [server-runbook](./server-runbook.md) M7의 parameterless Release 배포 또는 no-op 재실행으로 넘어간다.
자동 트리거 계약은 [ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)와 [init-operations](../exec-plan/active/init-operations.md) M2가 원본이다.

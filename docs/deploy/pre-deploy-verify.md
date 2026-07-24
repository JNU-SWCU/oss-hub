# 배포 전 단계 검증 (pre-deploy verification)

첫 GitHub Release 배포 전에 **로컬 랩탑 → 배포 EC2 서버-로컬 드라이런** 순서로 단계 검증한다.
앞 단계가 통과해야 다음으로 넘어간다. 목적은 회귀 위험(첫 배포는 `PREV_TAG`가 없어 자동 rollback 불가)을 사전 차단하는 것이다.
서버 접속·설치·job 절차는 [server-runbook](./server-runbook.md)이 원본이며, 이 문서는 검증 절차만 다룬다.

프로덕션 스택 정의는 저장소 루트 `compose.yml`(nginx / frontend / backend / postgres)이 원본이다.

## 표기 규약

- 아래 로컬 검증용 env는 **비시크릿 예시**다. 실제 운영 값은 이 저장소에 두지 않는다(운영 값은 배포 서버 `.env` / Jenkins Credentials Store).
- `<...>`, `REPLACE_*` 자리표시자는 로컬에서 각자 채운다.

## ① 로컬 랩탑 검증

내 개발 머신에서 프로덕션 `compose.yml`을 임시 태그·격리 프로젝트로 띄워 `/`·`/api/v1/health` smoke를 확인한다.
개발/운영 데이터와 섞이지 않도록 **격리 프로젝트명 `oss-hub-localverify`**를 쓴다.

### 로컬 검증용 env 템플릿 (비시크릿)

아래를 `oss-hub-localverify.env`처럼 **저장소 밖**(예: 홈 디렉터리)에 저장한다. `.env.*` 파일은 저장소에 커밋하지 않는다(public-safe 정책).
변수명은 저장소 루트 `.env.example`과 동일한 계약을 따른다.

```dotenv
# 로컬 검증 전용 — 비시크릿 예시. 저장소에 커밋하지 않는다.
IMAGE_TAG=localverify

# PostgreSQL (로컬 컨테이너 전용, 임의 로컬값)
POSTGRES_USER=oss
POSTGRES_PASSWORD=REPLACE_LOCAL_PW
POSTGRES_DB=osshub

# migration·runtime 공용. compose 네트워크의 postgres 서비스 DNS를 가리킨다.
DATABASE_URL=postgresql://oss:REPLACE_LOCAL_PW@postgres:5432/osshub

# 세션 서명 키 — base64url 32바이트 이상. 생성:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
SESSION_SECRET=

# 로컬 접속 origin
FRONTEND_URL=http://localhost:3000

# GitHub OAuth — 로컬 부팅용 형식만 맞춘 자리표시자.
# health 확인만 할 때는 형식상 값이면 되지만, backend가 부팅 시 검증하면
# 개발용 OAuth App의 값으로 대체한다.
GITHUB_OAUTH_CLIENT_ID=REPLACE_LOCAL_OAUTH_ID
GITHUB_OAUTH_CLIENT_SECRET=REPLACE_LOCAL_OAUTH_SECRET
```

### 실행

```sh
# 1) 이미지 로컬 빌드 (IMAGE_TAG=localverify)
docker build --file apps/frontend/Dockerfile --tag oss-hub-frontend:localverify .
docker build --file apps/backend/Dockerfile  --tag oss-hub-backend:localverify  .

# 2) 격리 프로젝트로 기동
COMPOSE_PROJECT_NAME=oss-hub-localverify \
  docker compose --env-file ~/oss-hub-localverify.env -f compose.yml up -d --wait --wait-timeout 120

# 3) smoke
curl -fsS http://127.0.0.1/            > /dev/null && echo "root OK"
curl -fsS http://127.0.0.1/api/v1/health > /dev/null && echo "health OK"
```

- 예상 출력: `root OK`, `health OK` (두 요청 모두 HTTP 200).
- 검증: 실패 시 `COMPOSE_PROJECT_NAME=oss-hub-localverify docker compose --env-file ~/oss-hub-localverify.env -f compose.yml logs`로 원인을 본다. `IMAGE_TAG`·필수 env 미설정이면 compose가 즉시 실패한다(`compose.yml`이 `${VAR:?}`로 강제).

### 정리 (로컬 한정)

```sh
# 로컬 격리 스택만 볼륨까지 제거 — 이 격리 프로젝트에서만 down -v 허용
COMPOSE_PROJECT_NAME=oss-hub-localverify \
  docker compose --env-file ~/oss-hub-localverify.env -f compose.yml down -v
```

- **주의**: `down -v`는 **로컬 격리 프로젝트(`oss-hub-localverify`)에서만** 허용한다. 운영 서버에서는 절대 `down -v`를 쓰지 않는다(`pgdata` 보존).

## ② 배포 EC2 서버-로컬 드라이런

로컬 검증(①)이 통과한 뒤, 배포 EC2에서 손으로 한 번 배포 흐름을 재현해 실서버 환경에서 동작을 확인한다.
접속은 [server-runbook](./server-runbook.md) M1(배포 EC2 전용, 다른 tailnet 호스트 금지)을 따른다.

```sh
# 배포 EC2에서 (운영 .env / Credentials Store env 사용, 임시 태그로 드라이런)
IMAGE_TAG=dryrun docker build --file apps/frontend/Dockerfile --tag oss-hub-frontend:dryrun .
IMAGE_TAG=dryrun docker build --file apps/backend/Dockerfile  --tag oss-hub-backend:dryrun  .
IMAGE_TAG=dryrun docker compose --env-file <운영 env 경로> -f compose.yml up -d --no-build --wait --wait-timeout 120
curl -fsS http://127.0.0.1/            > /dev/null && echo "root OK"
curl -fsS http://127.0.0.1/api/v1/health > /dev/null && echo "health OK"
```

- 예상 출력: `root OK`, `health OK`.
- 검증: 두 smoke가 200이면 서버-로컬 빌드·기동 경로가 건강하다. 이 드라이런은 파이프라인의 상태 파일(`current-release`)을 갱신하지 않는다.
- 정리: 드라이런 종료는 `docker compose ... down`(`-v` 없이). 운영 `pgdata`는 보존한다.

## ③ 다음 단계

①②가 모두 통과한 뒤에만 [server-runbook](./server-runbook.md) M7의 첫 Release `v0.1.0` 수동 트리거 e2e로 넘어간다.
webhook 자동화는 오늘 범위가 아니다(server-runbook §9 follow-up).

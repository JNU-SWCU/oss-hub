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

내 개발 머신에서 프로덕션 `compose.yml`을 임시 태그·격리 프로젝트로 띄워 loopback Compose ingress의 `/`·`/api/v1/health` smoke를 확인한다.
개발/운영 데이터와 섞이지 않도록 **격리 프로젝트명 `oss-hub-localverify`**를 쓴다.

### 로컬 검증용 env 템플릿 (비시크릿)

아래를 `oss-hub-localverify.env`처럼 **저장소 밖**(예: 홈 디렉터리)에 저장한다. `.env.*` 파일은 저장소에 커밋하지 않는다(public-safe 정책).
변수명은 저장소 루트 `.env.example`과 동일한 계약을 따른다. `compose.yml`이 강제하는 필수 키를 빠뜨리지 않는다.

```dotenv
# 로컬 검증 전용 — 비시크릿 예시. 저장소에 커밋하지 않는다.
IMAGE_TAG=localverify

# PostgreSQL (로컬 컨테이너 전용, 임의 로컬값)
POSTGRES_USER=oss
POSTGRES_PASSWORD=REPLACE_LOCAL_PW
POSTGRES_DB=osshub

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

이 단계는 **첫 Release 이전 greenfield 전용**이다. 운영 Compose 프로젝트명 `oss-hub`(Jenkinsfile `COMPOSE_PROJECT_NAME`)와 loopback `127.0.0.1:8081`을 그대로 쓰므로, 이미 서비스가 떠 있거나 상태 파일이 있으면 운영을 덮어쓴다.

```sh
# greenfield gate — 하나라도 걸리면 즉시 중단 (운영 덮어쓰기 방지)
test ! -e /var/lib/oss-hub/deploy-state/current-release
# compose 파일 cwd에 의존하지 않는다. docker 조회 실패도 중단(fail-closed).
running="$(docker ps --filter label=com.docker.compose.project=oss-hub --filter status=running -q)" || exit 1
test -z "$running"

# 배포 EC2에서 (운영 .env / Credentials Store env 사용, 임시 태그로 드라이런)
# 운영 env는 production 계약(SESSION_SECRET, TEAM_JOIN_CODE_SECRET, HTTPS FRONTEND_URL, OAuth 등)을 이미 충족해야 한다.
IMAGE_TAG=dryrun docker build --file apps/frontend/Dockerfile --tag oss-hub-frontend:dryrun .
IMAGE_TAG=dryrun docker build --file apps/backend/Dockerfile  --tag oss-hub-backend:dryrun  .
COMPOSE_PROJECT_NAME=oss-hub IMAGE_TAG=dryrun \
  docker compose --env-file <운영 env 경로> -f compose.yml up -d --no-build --wait --wait-timeout 120
curl -fsS http://127.0.0.1:8081/            > /dev/null && echo "root OK"
curl -fsS http://127.0.0.1:8081/api/v1/health > /dev/null && echo "health OK"
```

- 예상 출력: `root OK`, `health OK`.
- 검증: 두 smoke가 200이면 서버-로컬 빌드·기동 경로가 건강하다. 이 드라이런은 파이프라인의 상태 파일(`current-release`)을 갱신하지 않는다.
- 정리: `COMPOSE_PROJECT_NAME=oss-hub docker compose --env-file <운영 env 경로> -f compose.yml down`(`-v` 없이). 운영 `pgdata`는 보존한다.

## ③ 다음 단계

①②가 모두 통과한 뒤에만 [server-runbook](./server-runbook.md) M7의 첫 Release 수동 트리거 e2e로 넘어간다.
자동 트리거 계약은 [ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)와 [init-operations](../exec-plan/active/init-operations.md) M2가 원본이다.

## G007. 점검 창 검증 상세 (sequence 비소유)

순서·상태 전이·abort/rollback 원본은 [server-runbook G007](./server-runbook.md#g007-점검-창--legacy--v2-전환-canonical-sequence)이다.
이 절은 그 순서가 호출하는 **측정·판정 절차**만 적는다.
값을 채워 넣을 자리표시자 의미도 server-runbook G007 표기를 따른다.
이 문서를 실행했다는 사실만으로 production 변이 완료를 주장하지 않는다.

### G007 baseline·probe

step 2·4·7·8이 공유하는 lock 절차다.

1. **서비스 baseline 잠금**
   - `curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/`
   - `curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/api/v1/health`
   - 공인 TLS 동일 경로를 조직 표준 curl 옵션으로 1회씩 측정(실제 호스트·인증서 값은 저장소에 적지 않음)
   - 실행 중 frontend·backend 이미지 tag/label(또는 greenfield 부재)을 기록
   - 판정: 기록된 코드·tag 세트가 step 0 freeze와 모순 없으면 baseline 확정.
2. **D6 닫힘 확인**
   - 제출 파일 업로드 경로가 여전히 fail-closed인지 계약·응답으로 확인한다([ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)).
   - 판정: 업로드가 열렸으면 G007 실패(D6은 이 창에서 열지 않음).
3. **Jenkins 카운터 snapshot**
   - 운영 job `oss-hub-release-cd`의 last build number, running count, queue count, job log mtime/size를 기록한다.
   - 조회 실패는 fail-closed로 취급하고 probe를 진행하지 않는다.
4. **unauthorized trigger probe (old·new 각 1회)**
   - 인증 헤더 없음 또는 고의로 잘못된 자격으로
     - `POST https://<PUBLIC_DEPLOY_BASE><OLD_TRIGGER_PATH>`
     - `POST https://<PUBLIC_DEPLOY_BASE><NEW_TRIGGER_PATH>`
   - `<PUBLIC_DEPLOY_BASE>` 실값은 저장소에 쓰지 않는다.
   - body는 비우거나 8 KiB 이하 더미만 사용한다.
   - 판정(모두 필요): HTTP non-2xx, build number 불변, running 불변, queue 불변, job log mtime/size 불변.
5. **인가된 신 경로 성공 probe**(step 7–8 전용, 게이트 `true`일 때만)
   - 전용 deployer 자격으로 `POST ...<NEW_TRIGGER_PATH>`(파라미터 없음).
   - 판정: job이 수락·완료되고, no-op 또는 정상 배포 계약([ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md))을 만족.

### G007 C3 검증 job 판정

- pin 대상은 `<LEGACY_JENKINSFILE_SHA>` 40-hex full SHA다. 브랜치 이름만 고정하는 것은 실패다.
- 1회 parameterless 실행 결과가 SUCCESS여야 한다.
- 실행 전후 서비스 snapshot(이미지 tag/SHA, compose running set)이 동일해야 한다.
- 운영 job 이름·트리거 URL·Credentials id를 C3 job과 공유하지 않는다.

### G007 C4 — backup retention N=120 격리 fixture

- **blocked 조건:** Jenkinsfile.v2 retention과 **바이트 동일 구현**을 호출할 공유 pruning surface(스크립트 entrypoint 또는 추출된 함수)가 저장소에 없으면 C4를 실행하지 않고 blocked로 기록한다.
- surface가 생긴 뒤에만 아래를 수행한다.
  1. 운영 `<BACKUP_DIR>`의 name+byte inventory를 스냅샷한다(내용 열람·삭제 금지).
  2. 운영 경로 밖의 빈 디렉터리에 synthetic backup 항목 121개를 만든다.
  3. `BACKUP_RETENTION_N=120`과 동일한 구현으로 그 디렉터리에만 pruning을 실행한다.
  4. 판정: 남은 항목 수=120, fixture 디렉터리는 절차가 정한 대로 제거 가능, 운영 `<BACKUP_DIR>` inventory가 바이트·이름 모두 전후 동일.
- 실측 N 승인 기록(이슈 #305)과 fixture 성공은 별개다. 승인 숫자만으로 운영 디렉터리 pruning을 건너뛰지 않는다.

### G007 fault drill 관측

- fault Release는 식별 가능한 tag 명명 규칙을 쓰고 점검 창 종료 전 반드시 삭제한다.
- rollback 관찰: 서비스 교체/smoke 실패 후 `PREV_TAG` 이미지로 **한 번** 돌아가는 로그만을 성공으로 센다. DB restore는 자동 범위 밖이다.
- 정리 판정: fault tag, 해당 Release, fault image tag가 운영 inventory에 없고, 최종 실행 중 tag가 정상 Release다.

### G007 S4 checklist

아래를 위부터 내려가며 평가하고, 한 줄이라도 실패면 S4를 선언하지 않는다.

1. `DEPLOY_TRIGGER_ENABLED` == `true`
2. 운영 job 파라미터 정의 없음
3. 운영 job running=0, queue=0
4. 실행 중 frontend·backend tag가 정상 Release이고 fault tag가 아님
5. loopback·TLS `/`·`/api/v1/health` == 2xx
6. D6 닫힘(업로드 fail-closed) 유지
7. old trigger unauthorized probe = non-2xx + delta 0
8. 최근 인가 new trigger 성공 증거 존재
9. C4 통과 증거 또는 «공유 pruning surface 부재로 blocked» 명시
10. fault Release/tag/image 잔존 없음
11. tag ruleset 변경 없음(D8)

### G007과 ①②③의 관계

- ① 로컬·② EC2 dry-run은 첫 greenfield 배포 전 회귀 차단용이다.
- 이미 운영 job·host nginx가 있는 점검 창에서는 ①②를 재실행해 운영을 덮어쓰지 않는다.
- 점검 창 검증은 이 절과 server-runbook G007만 따른다.

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

# FRONTEND_URL은 세션·OAuth origin 원본이며 production HTTPS 강제는 배포 preflight가 소유한다.
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

# exact-head compose.yml은 GMAIL_* 4종을 필수 매핑한다(MAIL_MODE 키 없음).
# 로컬 smoke 전용 비시크릿 자리표시자 — 운영 재사용 금지. 실발송에 쓰지 않는다.
# G004 mail 계약(MAIL_MODE)이 main에 병합된 뒤에는 이 네 줄을 MAIL_MODE=dry-run 한 줄로 교체한다.
GMAIL_SENDER=localverify-sender@example.test
GMAIL_OAUTH_CLIENT_ID=localverify-gmail-client-id
GMAIL_OAUTH_CLIENT_SECRET=localverify-gmail-client-secret
GMAIL_OAUTH_REFRESH_TOKEN=localverify-gmail-refresh-token
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
# 운영 env는 production 계약(SESSION_SECRET, TEAM_JOIN_CODE_SECRET, FRONTEND_URL, GMAIL_* 4종, OAuth 등)을 이미 충족해야 한다. G004 mail 계약 병합 후에는 MAIL_MODE=send가 운영 기본이다.
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
측정 원본 구현은 버전된 저장소 스크립트 `scripts/check-g007-window.sh` 한 곳이다.
이 문서를 실행했다는 사실만으로 production 변이 완료를 주장하지 않는다.
**S4 수락 측정의 원본은 이 절과 그 스크립트다.** 런북은 `G007_FINAL=PASS|BLOCKED` 한 줄만 소비한다.

### G007 스크립트 계약

- 경로: `scripts/check-g007-window.sh` (버전 출력: `bash scripts/check-g007-window.sh version`).
- fail-closed: producer·parse·schema·freshness·assertion 실패는 비0 종료이며, final-gate는 항상 정확히 한 줄 `G007_FINAL=PASS` 또는 `G007_FINAL=BLOCKED`를 낸다. 무조건 PASS 경로 없음.
- 출력은 코드·boolean·64-hex digest·판정 키만. 시크릿·공인 실호스트·backup 실경로·로그 본문을 stdout에 인쇄하지 않는다.
- 공개 안전 env 이름만 사용한다. 값은 배포 EC2 셸/secret store에서만 채운다.

공통 env (값은 저장소에 두지 않음):

| 변수 | 용도 |
| --- | --- |
| `G007_COMPOSE_PROJECT` | 기본 `oss-hub` |
| `G007_EXPECTED_SERVICES` | 기본 `backend,frontend,minio,minio-bucket,nginx,postgres` (compose.yml 서비스 집합) |
| `G007_BACKUP_DIR` | 운영 backup 디렉터리 (실경로; 비-symlink 존재 디렉터리) |
| `G007_TLS_BASE` | 공인 TLS origin (`https://…`, 트레일링 슬래시 없이) |
| `G007_JENKINS_BASE` | Jenkins loopback API root (예: `http://127.0.0.1:8080`) |
| `G007_JENKINS_USER` / `G007_JENKINS_TOKEN` | 인증된 snapshot·queue 조회 |
| `G007_JENKINS_JOB` | 기본 `oss-hub-release-cd` |
| `G007_OLD_TRIGGER_PATH` / `G007_NEW_TRIGGER_PATH` | 비인가 probe 경로 (TLS_BASE 상대) |
| `G007_D6_URL` | 기본 `http://127.0.0.1:8081/api/v1/submission-files` |
| `G007_EVIDENCE_DIR` | final-gate가 소비하는 현재 창 machine-readable 증거 디렉터리 |
| `G007_EVIDENCE_MAX_AGE_SEC` | 증거 신선도 상한(초). 기본 86400 |
| `G007_PRUNE_CMD` / `G007_C4_FIXTURE_DIR` | C4 same-code surface와 운영 밖 fixture 디렉터리 |

증거 파일은 KV 줄(`KEY=value`)이며, producer가 `CAPTURED_AT_UNIX`를 넣거나 `write-evidence`로 기록한다.

```sh
# 예: 서브커맨드 stdout을 증거로 고정
export G007_EVIDENCE_DIR="${G007_EVIDENCE_DIR:?set evidence dir outside repo}"
bash scripts/check-g007-window.sh d6-probe \
  | bash scripts/check-g007-window.sh write-evidence d6
```

### G007 공통 측정 서브커맨드

운영자는 배포 EC2에서 저장소 checkout 루트를 cwd로 두고 아래를 호출한다.

```sh
# loopback health (LOOPBACK_ROOT / LOOPBACK_HEALTH, 둘 다 2xx여야 ok)
bash scripts/check-g007-window.sh loopback-health

# 공인 TLS 동일 경로 (G007_TLS_BASE 필수)
bash scripts/check-g007-window.sh tls-health

# compose 컨테이너 identity digest (64-hex). docker ps/inspect 실패·서비스 집합 불일치·비-64hex → 실패
# 기대 서비스 집합: backend,frontend,minio,minio-bucket,nginx,postgres
bash scripts/check-g007-window.sh container-identity-digest

# backup inventory digest (64-hex). 비-symlink 존재 디렉터리, find/read/hash 모두 성공해야 함
# 정렬된 "상대경로<TAB>content-sha256" 매니페스트의 sha256
bash scripts/check-g007-window.sh backup-inventory-digest
```

### G007 baseline·probe

step 2·4·7·8이 공유하는 lock 절차다. 각 서브커맨드가 판정 키를 인쇄한다. 하나라도 비0이면 `BASELINE_PROBE=BLOCKED`.

1. **서비스 baseline 잠금**

```sh
bash scripts/check-g007-window.sh loopback-health
bash scripts/check-g007-window.sh tls-health
bash scripts/check-g007-window.sh container-identity-digest
```

   - 판정: loopback·TLS 네 코드 2xx, container digest 64-hex, 서비스 집합이 기대와 일치. 실패·모순이면 baseline 거부.

2. **D6 닫힘 확인 (실행 가능한 거절 관측)**
   - 계약 원본: [ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md) — object backup 간극이 닫히기 전 제출 파일 업로드 경로는 fail-closed.
   - 합성 1-byte body POST. 합격 거절은 **정확히 `D6_HTTP=403` 한 값**만.

```sh
bash scripts/check-g007-window.sh d6-probe
# 성공 시: D6_HTTP=403 / D6=PASS
# 2xx·401·404·405·5xx·빈 코드·curl 실패 → D6=BLOCKED, S4 금지
```

3. **Jenkins 카운터 snapshot** (인증 loopback API)

```sh
# G007_JENKINS_BASE / G007_JENKINS_USER / G007_JENKINS_TOKEN / G007_JENKINS_JOB
bash scripts/check-g007-window.sh jenkins-snapshot
# 출력(숫자·identity만):
#   JENKINS_LAST_BUILD_NUMBER JENKINS_BUILDING(0|1)
#   JENKINS_RUNNING_COUNT JENKINS_QUEUE_COUNT
#   JENKINS_LOG_IDENTITY  JENKINS_SNAPSHOT_STATUS=ok
# HTTP non-2xx·JSON/schema 실패·필드 부재 → 비0 (fail-closed)
```

4. **unauthorized trigger probe (old·new 각 1회)**

```sh
# G007_TLS_BASE G007_OLD_TRIGGER_PATH G007_NEW_TRIGGER_PATH + Jenkins auth env
bash scripts/check-g007-window.sh unauthorized-trigger-probe
# 판정(모두 필요): old/new HTTP non-2xx, build/running/queue/log delta 전부 0
# 성공 시 UNAUTH_PROBE=PASS, 아니면 UNAUTH_PROBE=BLOCKED
```

5. **인가된 신 경로 성공 probe**(step 7–8 전용, 게이트 `true`일 때만)
   - 인증 트리거 자체는 운영 자격으로 수행하고, 결과 KV만 증거 디렉터리에 기록한다.

```sh
# 운영자가 관측한 결과를 증거로 고정 (예시 키)
printf '%s\n' 'AUTH_NEW_TRIGGER=PASS' \
  | bash scripts/check-g007-window.sh write-evidence auth_new_trigger
```

   - 판정: job 수락·완료 및 ADR-002 no-op/정상 배포 계약. 실패면 `AUTH_NEW_TRIGGER=BLOCKED`.

- **절 출력:** 1–4(및 해당 시 5) 모두 충족 시 baseline 잠금 유지, 아니면 창 abort.

### G007 C3 검증 job 판정

pin 대상은 `<LEGACY_JENKINSFILE_SHA>` 40-hex full SHA다. 브랜치 이름만 고정하는 것은 실패다.
운영 job 이름·트리거 URL·Credentials id를 C3 job과 공유하지 않는다.

**before (Build Now 직전):**

```sh
before_digest="$(bash scripts/check-g007-window.sh container-identity-digest \
  | awk -F= '/^CONTAINER_IDENTITY_DIGEST=/{print $2}')"
before_health="$(
  { bash scripts/check-g007-window.sh loopback-health
    bash scripts/check-g007-window.sh tls-health
  } | paste -sd' ' -
)"
printf 'C3_BEFORE_DIGEST_SET=1\n'   # 실제 hex는 로컬만 보관, PR/이슈에는 동등 boolean만
```

**after (`<C3_JOB_NAME>` 1회 parameterless 실행 종료 직후):**

```sh
after_digest="$(bash scripts/check-g007-window.sh container-identity-digest \
  | awk -F= '/^CONTAINER_IDENTITY_DIGEST=/{print $2}')"
after_health="$(
  { bash scripts/check-g007-window.sh loopback-health
    bash scripts/check-g007-window.sh tls-health
  } | paste -sd' ' -
)"
G007_C3_BEFORE_DIGEST="$before_digest" \
G007_C3_AFTER_DIGEST="$after_digest" \
G007_C3_BEFORE_HEALTH="$before_health" \
G007_C3_AFTER_HEALTH="$after_health" \
  bash scripts/check-g007-window.sh c3-verify
# C3=PASS 또는 C3=BLOCKED
# identity_equal + health_unchanged_2xx boolean 동시 충족 필요
```

- 추가 필수: job 결과 `SUCCESS`, Configure의 pin이 여전히 `<LEGACY_JENKINSFILE_SHA>`.
- **불변식:** container ID·image ID·restartCount 전후 동일(digest 동등 = restart delta 0), loopback·TLS health 전후 동일하며 각 코드 2xx.
- 이미지만 같고 컨테이너가 재생성된 경우 digest 불일치 → `C3=BLOCKED`.
- docker ps/inspect 실패는 digest를 만들지 않고 즉시 실패한다(실패 대입 비교 금지).

### G007 C4 — backup retention N=120 격리 fixture

```sh
# 공유 pruning surface가 없으면 스크립트가 즉시 C4=BLOCKED / C4_REASON=missing_shared_pruning_surface
# surface가 있을 때만:
#   G007_PRUNE_CMD  — 바이트 동일 구현 호출 한 줄 (운영 디렉터리를 인자로 넘기지 않음)
#   G007_C4_FIXTURE_DIR — 운영 경로 밖 빈 디렉터리
#   G007_BACKUP_DIR — 운영 inventory read-only digest 전후 비교
bash scripts/check-g007-window.sh c4-verify
```

- 동작: 운영 inventory digest before → fixture 121개 생성 → `BACKUP_RETENTION_N=120`으로 fixture에만 prune → fixture 파일 수 120 확인 → 운영 inventory digest after 동등.
- `C4=PASS`일 때만 S4 진행 가능. `C4=BLOCKED`(surface 부재 포함)는 기록이 아니라 **종료 차단**.
- 실측 N 승인 기록(이슈 #305)과 fixture 성공은 별개다. same-size 내용 치환은 content sha256 포함 digest로 탐지한다.
- 공개 증거: `C4=PASS|BLOCKED`와 `C4_OPERATING_INVENTORY_EQUAL=true|false` boolean만.

### G007 fault drill 관측

측정만 담당한다. commit/tag/accept/트리거 **순서 원본은 런북 Step 6.6**이다.

- 관측 성공 조건(모두):
  1. fault job 콘솔에 서비스 교체/smoke 실패 후 `PREV_TAG` 이미지로 **한 번** 복구하는 로그가 있다.
  2. 그 관측 시점 이전에 수동 정상 Release 트리거가 없다.
  3. 정리 후: `gh release view <FAULT_TAG>` 실패(없음), `git ls-remote --tags origin <FAULT_TAG>` 빈 출력, `docker images`에 fault tag 없음.
  4. 최종 실행 중 tag = 정상 `<CLEAN_TAG>`.
- DB restore는 자동 범위 밖이다.
- 운영자가 관측 결과를 증거로 고정:

```sh
printf '%s\n' 'FAULT_DRILL=PASS' \
  | bash scripts/check-g007-window.sh write-evidence fault_drill
# 실패 관측 시 FAULT_DRILL=BLOCKED
```

### G007 final gate (`G007_FINAL`)

런북 Step 8이 이 절만 호출한다. **수락 체크리스트 원본은 여기 한 곳**이다.
final-gate는 `G007_EVIDENCE_DIR`의 **현재 창** machine-readable 증거만 소비한다.
주석 체크리스트나 무조건 `echo PASS` 경로는 없다.

필수 증거 파일(각 KV, 신선도·`CAPTURED_AT_UNIX` 검사):

| 파일 | 필수 키(요약) |
| --- | --- |
| `deploy_gate.kv` | `DEPLOY_TRIGGER_ENABLED=true` |
| `jenkins_idle.kv` | `JOB_PARAMETERIZED=false`, `JENKINS_RUNNING_COUNT=0`, `JENKINS_QUEUE_COUNT=0` |
| `running_tag.kv` | `RUNNING_TAG` == `CLEAN_TAG`, fault tag 아님 |
| `loopback_health.kv` | `LOOPBACK_ROOT`·`LOOPBACK_HEALTH` 2xx |
| `tls_health.kv` | `TLS_ROOT`·`TLS_HEALTH` 2xx |
| `d6.kv` | `D6_HTTP=403`, `D6=PASS` |
| `unauth_probe.kv` | `UNAUTH_PROBE=PASS`, old/new non-2xx, delta 전부 0 |
| `auth_new_trigger.kv` | `AUTH_NEW_TRIGGER=PASS` |
| `c4.kv` | `C4=PASS` only (`C4=BLOCKED`·부재 → 즉시 BLOCKED) |
| `fault_drill.kv` | `FAULT_DRILL=PASS` |
| `d8_ruleset.kv` | `RULESET_UNCHANGED=true` (이 창에서 ruleset API/UI 미호출) |

```sh
# 창 동안 수집한 증거를 G007_EVIDENCE_DIR에 둔 뒤:
export G007_EVIDENCE_DIR="${G007_EVIDENCE_DIR:?}"
bash scripts/check-g007-window.sh final-gate
# 출력 한 줄: G007_FINAL=PASS  또는  G007_FINAL=BLOCKED
# (BLOCKED 시 G007_FINAL_REASON=… 가 함께 나올 수 있다. 런북은 G007_FINAL 줄만 전이 입력으로 쓴다.)
```

증거 수집 예시(측정 직후 기록; 값은 해당 창 producer stdout에서 온다):

```sh
export G007_EVIDENCE_DIR="${G007_EVIDENCE_DIR:?}"

# 게이트 관측값(JSON 한 건) — gh는 --json name,value 후 단일 값 단언
gate_val="$(gh variable list --repo "<GITHUB_OWNER>/<GITHUB_REPO>" --json name,value \
  --jq '.[] | select(.name=="DEPLOY_TRIGGER_ENABLED") | .value')"
test "$(printf '%s' "$gate_val" | wc -l | tr -d ' ')" = "1"
printf 'DEPLOY_TRIGGER_ENABLED=%s\n' "$gate_val" \
  | bash scripts/check-g007-window.sh write-evidence deploy_gate

bash scripts/check-g007-window.sh jenkins-snapshot \
  | { cat; printf 'JOB_PARAMETERIZED=false\n'; } \
  | bash scripts/check-g007-window.sh write-evidence jenkins_idle

# running_tag.kv / auth_new_trigger.kv / fault_drill.kv / d8_ruleset.kv 는 런북 절차 관측 후 write-evidence
bash scripts/check-g007-window.sh loopback-health \
  | bash scripts/check-g007-window.sh write-evidence loopback_health
bash scripts/check-g007-window.sh tls-health \
  | bash scripts/check-g007-window.sh write-evidence tls_health
bash scripts/check-g007-window.sh d6-probe \
  | bash scripts/check-g007-window.sh write-evidence d6
bash scripts/check-g007-window.sh unauthorized-trigger-probe \
  | bash scripts/check-g007-window.sh write-evidence unauth_probe
bash scripts/check-g007-window.sh c4-verify \
  | bash scripts/check-g007-window.sh write-evidence c4

bash scripts/check-g007-window.sh final-gate
```

- **C4 특별 규칙:** `C4=BLOCKED`(공유 surface 부재 포함)는 기록이 아니라 **종료 차단**이다. 게이트를 off로 두고 S4를 선언하지 않는다.
- 출력은 반드시 다음 중 한 줄: `G007_FINAL=PASS` | `G007_FINAL=BLOCKED`.
  런북은 이 한 줄만으로 S4 전이/거절을 결정한다.

### G007과 ①②③의 관계

- ① 로컬·② EC2 dry-run은 첫 greenfield 배포 전 회귀 차단용이다.
- 이미 운영 job·host nginx가 있는 점검 창에서는 ①②를 재실행해 운영을 덮어쓰지 않는다.
- 점검 창 검증은 이 절·`scripts/check-g007-window.sh`·server-runbook G007만 따른다.

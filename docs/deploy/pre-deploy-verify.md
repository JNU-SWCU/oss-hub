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
GMAIL_SENDER=REPLACE_LOCAL_GMAIL_SENDER
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
**S4 수락 측정의 원본은 이 절이다.** 런북은 아래가 출력하는 `G007_FINAL=PASS|BLOCKED` 한 줄만 소비한다.

### G007 공통 헬퍼 (로컬 측정용, 출력은 코드·boolean·다이제스트만)

아래 함수는 운영자가 배포 EC2 세션에서 한 번 정의하고 재사용한다. 시크릿·공인 실호스트·backup 실경로를 stdout에 인쇄하지 않는다.

```sh
# loopback health codes (두 줄: root_code health_code)
g007_loopback_health() {
  printf 'root=%s health=%s\n' \
    "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8081/)" \
    "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8081/api/v1/health)"
}

# 공인 TLS 동일 경로 — 조직 표준 curl 옵션·CA. 실호스트는 환경변수로만 (저장소/로그 금지)
#   export G007_TLS_BASE='https://<PUBLIC_DEPLOY_BASE>'
g007_tls_health() {
  : "${G007_TLS_BASE:?set G007_TLS_BASE in shell env only}"
  printf 'tls_root=%s tls_health=%s\n' \
    "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "${G007_TLS_BASE}/")" \
    "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "${G007_TLS_BASE}/api/v1/health")"
}

# compose 프로젝트 컨테이너: name|id|image_id|restart_count 정렬 텍스트 → sha256 한 줄
g007_container_identity_digest() {
  docker ps -a --filter label=com.docker.compose.project=oss-hub -q | sort | while read -r id; do
    docker inspect --format '{{.Name}}|{{.Id}}|{{.Image}}|{{.RestartCount}}' "$id"
  done | sort | openssl dgst -sha256 | awk '{print $NF}'
}

# 운영 backup 디렉터리 read-only inventory digest (파일명+내용 바이트, 정렬, 비인쇄)
# 경로 실값은 셸 변수로만. 다이제스트 hex만 stdout.
#   export G007_BACKUP_DIR='<BACKUP_DIR>'
g007_backup_inventory_digest() {
  : "${G007_BACKUP_DIR:?set G007_BACKUP_DIR in shell env only}"
  # 일반 파일만. 이름 정렬 후 "상대경로<TAB>sha256(content)" 줄을 다시 sha256.
  # GNU find/sort 가정. 디렉터리 자체·타임스탬프·권한은 포함하지 않는다(내용+이름만).
  (
    cd "$G007_BACKUP_DIR" || exit 1
    find . -type f -print0 | sort -z | while IFS= read -r -d '' f; do
      # 경로에 개행 없음 전제(backup 파일명 계약). 내용 바이트 다이제스트.
      sum="$(openssl dgst -sha256 "$f" | awk '{print $NF}')"
      printf '%s\t%s\n' "${f#./}" "$sum"
    done
  ) | openssl dgst -sha256 | awk '{print $NF}'
}
```

### G007 baseline·probe

step 2·4·7·8이 공유하는 lock 절차다. 종료 시 `BASELINE_PROBE=PASS` 또는 `BASELINE_PROBE=BLOCKED` 한 줄을 인쇄한다.

1. **서비스 baseline 잠금**

```sh
g007_loopback_health
g007_tls_health
g007_container_identity_digest
docker ps --filter label=com.docker.compose.project=oss-hub \
  --filter name=frontend --filter name=backend \
  --format '{{.Names}} {{.Image}}'
```

   - 판정: loopback·TLS 네 코드가 모두 `2xx`(정규식 `^2[0-9][0-9]$`). 컨테이너 digest·tag 세트가 step 0 freeze와 모순 없으면 baseline 확정. 조회 실패·비2xx·모순이면 `BASELINE_PROBE=BLOCKED`.

2. **D6 닫힘 확인 (실행 가능한 거절 관측)**
   - 계약 원본: [ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md) — object backup 간극이 닫히기 전 제출 파일 업로드 경로는 fail-closed.
   - **placeholder curl probe**(실호스트는 `G007_TLS_BASE` 또는 loopback; 인증 쿠키·토큰을 저장소에 두지 않음). 합성 최소 body로 POST:

```sh
# 합성 1-byte body. 실제 사용자 파일·운영 객체 키를 쓰지 않는다.
D6_CODE="$(curl -sS -o /tmp/g007-d6.body -w '%{http_code}' --max-time 15 \
  -X POST "http://127.0.0.1:8081/api/v1/submission-files" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/octet-stream' \
  --data-binary 'x')"
printf 'D6_HTTP=%s\n' "$D6_CODE"
# body에 시크릿이 있으면 인쇄·커밋하지 않는다. 판정은 HTTP 코드와 "업로드 성공 아님"만.
```

   - **정확히 하나의 합격 거절 결과:** `D6_HTTP=403` 한 값만 PASS다 (Compose ingress fail-closed 거절).
     - `2xx` → 업로드 경로가 열린 것 → `BASELINE_PROBE=BLOCKED` (G007 실패; D6은 이 창에서 열지 않음).
     - `401`·`404`·`405`·`5xx`·기타 non-403 → **관측 모호**(세션 부재·라우팅 오판·백엔드 오류와 구분 불가) → `BASELINE_PROBE=BLOCKED`, **S4 금지**.
     - curl 실패·타임아웃·빈 코드 → 모호 → `BASELINE_PROBE=BLOCKED`, **S4 금지**.
   - 공개 증거에는 `D6_HTTP=<code>`와 PASS/BLOCKED만 남기고 쿠키·토큰·body를 남기지 않는다.

3. **Jenkins 카운터 snapshot**

```sh
# <JENKINS_UI> 또는 loopback API (인증은 로컬 세션/크레덴셜; 값을 로그에 남기지 않음)
# 기록 필드(숫자만): lastBuild.number, lastBuild.building(0/1), queue items count for job,
# job 로그 파일 mtime epoch, size bytes.
# 조회 실패 → fail-closed, probe 중단, BASELINE_PROBE=BLOCKED
```

4. **unauthorized trigger probe (old·new 각 1회)**

```sh
: "${G007_TLS_BASE:?}"
# 스냅샷 before (숫자 필드만 로컬 변수에)
# ... last_no_b, run_b, q_b, log_mtime_b, log_size_b ...

unauth_post() {
  path="$1"
  curl -sS -o /tmp/g007-unauth.body -w '%{http_code}' --max-time 15 \
    -X POST "${G007_TLS_BASE}${path}" \
    -H 'Content-Type: application/octet-stream' \
    --data-binary ''
  # 인증 헤더 없음. 또는 고의로 잘못된 Authorization 한 줄.
}
printf 'old=%s\n' "$(unauth_post '<OLD_TRIGGER_PATH>')"
printf 'new=%s\n' "$(unauth_post '<NEW_TRIGGER_PATH>')"

# 스냅샷 after — 모든 delta == 0 이고 HTTP가 non-2xx 여야 PASS
```

   - 판정(모두 필요): HTTP non-2xx, build number 불변, running 불변, queue 불변, job log mtime/size 불변. 하나라도 실패면 `BASELINE_PROBE=BLOCKED`.

5. **인가된 신 경로 성공 probe**(step 7–8 전용, 게이트 `true`일 때만)

```sh
curl -sS -o /tmp/g007-auth-trigger.body -w '%{http_code}\n' \
  -X POST "${G007_TLS_BASE}<NEW_TRIGGER_PATH>" \
  -u "<DEPLOYER_USER>:<DEPLOYER_API_TOKEN>"
```

   - 판정: job이 수락·완료되고, no-op 또는 정상 배포 계약([ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md))을 만족. 실패면 BLOCKED.

- **절 출력:** 1–4(및 해당 시 5) 모두 충족 시 `BASELINE_PROBE=PASS`, 아니면 `BASELINE_PROBE=BLOCKED`.

### G007 C3 검증 job 판정

pin 대상은 `<LEGACY_JENKINSFILE_SHA>` 40-hex full SHA다. 브랜치 이름만 고정하는 것은 실패다.
운영 job 이름·트리거 URL·Credentials id를 C3 job과 공유하지 않는다.

**before (Build Now 직전):**

```sh
C3_BEFORE_DIGEST="$(g007_container_identity_digest)"
C3_BEFORE_HEALTH="$(g007_loopback_health); $(g007_tls_health)"
printf 'C3_BEFORE_DIGEST_SET=1\n'   # 실제 hex는 로컬만 보관, PR/이슈에는 동등 boolean만
```

**after (`<C3_JOB_NAME>` 1회 parameterless 실행 종료 직후):**

```sh
C3_AFTER_DIGEST="$(g007_container_identity_digest)"
C3_AFTER_HEALTH="$(g007_loopback_health); $(g007_tls_health)"
# restart delta: before/after digest 동등이면 identity·restartCount 모두 불변
if [ "$C3_BEFORE_DIGEST" = "$C3_AFTER_DIGEST" ] \
  && [ "$C3_BEFORE_HEALTH" = "$C3_AFTER_HEALTH" ] \
  && printf '%s\n' "$C3_AFTER_HEALTH" | grep -Eq 'root=2[0-9][0-9]' \
  && printf '%s\n' "$C3_AFTER_HEALTH" | grep -Eq 'health=2[0-9][0-9]' \
  && printf '%s\n' "$C3_AFTER_HEALTH" | grep -Eq 'tls_root=2[0-9][0-9]' \
  && printf '%s\n' "$C3_AFTER_HEALTH" | grep -Eq 'tls_health=2[0-9][0-9]'; then
  echo 'C3=PASS'
else
  echo 'C3=BLOCKED'
fi
```

- 추가 필수: job 결과 `SUCCESS`, Configure의 pin이 여전히 `<LEGACY_JENKINSFILE_SHA>`.
- **불변식:** container ID·image ID·restartCount 전후 동일(digest 동등 = restart delta 0), loopback·TLS health 전후 동일 문자열이며 각 코드 2xx.
- 이미지만 같고 컨테이너가 재생성된 경우 digest 불일치 → `C3=BLOCKED`.
- 공개 증거: `C3=PASS` 또는 `C3=BLOCKED`와 `identity_equal=true|false`, `health_unchanged_2xx=true|false` boolean만.

### G007 C4 — backup retention N=120 격리 fixture

- **blocked 조건 (S4 불가):** Jenkinsfile.v2 retention과 **바이트 동일 구현**을 호출할 공유 pruning surface(스크립트 entrypoint 또는 추출된 함수)가 저장소에 없으면 C4를 실행하지 않고 다음을 인쇄한다:

```text
C4=BLOCKED
C4_REASON=missing_shared_pruning_surface
```

  이 결과는 런북에서 `DEPLOY_TRIGGER_ENABLED=false` + **S4 선언 금지**로 소비된다. «기록만 하고 S4»는 허용되지 않는다.

- surface가 생긴 뒤에만 아래를 수행한다.

```sh
: "${G007_BACKUP_DIR:?}"
: "${G007_C4_FIXTURE_DIR:?}"   # 운영 경로 밖 빈 디렉터리 (실경로 저장소 금지)
: "${G007_PRUNE_CMD:?}"        # 공유 surface 호출 한 줄 (예: 리뷰된 스크립트 entrypoint)

# 1) 운영 inventory digest before (read-only, 삭제·열람 출력 금지)
BEFORE="$(g007_backup_inventory_digest)"

# 2) fixture 121개 synthetic backup 항목 (운영 디렉터리와 분리)
rm -rf "$G007_C4_FIXTURE_DIR"
mkdir -p "$G007_C4_FIXTURE_DIR"
# 이름 정렬 시 가장 오래된 1개가 제거 대상이 되도록 접두 인덱스를 0-pad
i=0
while [ "$i" -lt 121 ]; do
  printf 'fixture-%03d\n' "$i" > "$G007_C4_FIXTURE_DIR/backup-$(printf '%03d' "$i").sql"
  i=$((i + 1))
done
test "$(find "$G007_C4_FIXTURE_DIR" -type f | wc -l | tr -d ' ')" = "121"

# 3) BACKUP_RETENTION_N=120 과 동일한 구현으로 fixture 디렉터리에만 실행
#    운영 G007_BACKUP_DIR 을 인자로 넘기지 않는다.
BACKUP_RETENTION_N=120 BACKUP_DIR="$G007_C4_FIXTURE_DIR" sh -c "$G007_PRUNE_CMD"
test "$(find "$G007_C4_FIXTURE_DIR" -type f | wc -l | tr -d ' ')" = "120"

# 4) 운영 inventory digest after
AFTER="$(g007_backup_inventory_digest)"

if [ "$BEFORE" = "$AFTER" ]; then
  echo 'C4=PASS'
  echo 'C4_OPERATING_INVENTORY_EQUAL=true'
else
  echo 'C4=BLOCKED'
  echo 'C4_OPERATING_INVENTORY_EQUAL=false'
fi

# 5) fixture 디렉터리 제거 (운영 경로 아님)
rm -rf "$G007_C4_FIXTURE_DIR"
```

- 판정: `C4=PASS`일 때만 S4 진행 가능. `C4_OPERATING_INVENTORY_EQUAL`은 boolean만 공개하고 before/after hex·파일 목록·경로는 공개 이슈/PR에 붙이지 않는다.
- 실측 N 승인 기록(이슈 #305)과 fixture 성공은 별개다. 승인 숫자만으로 운영 디렉터리 pruning을 건너뛰지 않는다.
- same-size 내용 치환은 content sha256 포함 digest로 탐지한다.

### G007 fault drill 관측

측정만 담당한다. commit/tag/accept/트리거 **순서 원본은 런북 Step 6.6**이다.

- 관측 성공 조건(모두):
  1. fault job 콘솔에 서비스 교체/smoke 실패 후 `PREV_TAG` 이미지로 **한 번** 복구하는 로그가 있다.
  2. 그 관측 시점 이전에 수동 정상 Release 트리거가 없다.
  3. 정리 후: `gh release view <FAULT_TAG>` 실패(없음), `git ls-remote --tags origin <FAULT_TAG>` 빈 출력, `docker images`에 fault tag 없음.
  4. 최종 실행 중 tag = 정상 `<CLEAN_TAG>`.
- DB restore는 자동 범위 밖이다.
- 출력: `FAULT_DRILL=PASS` 또는 `FAULT_DRILL=BLOCKED`.

### G007 final gate (`G007_FINAL`)

런북 Step 8이 이 절만 호출한다. **수락 체크리스트 원본은 여기 한 곳**이다. 위부터 평가하고 한 줄이라도 실패면 `G007_FINAL=BLOCKED`를 인쇄하고 중단한다.

```sh
# 아래를 순서대로 평가. 모든 항목 PASS일 때만 마지막 줄 G007_FINAL=PASS.

# 1) 게이트
test "$(gh variable list --repo "<GITHUB_OWNER>/<GITHUB_REPO>" --jq '.[] | select(.name=="DEPLOY_TRIGGER_ENABLED") | .value')" = "true"

# 2) 운영 job 파라미터 없음 — <JENKINS_UI> Configure에서 parameterized unchecked
# 3) running=0 queue=0 — <JENKINS_UI> 또는 API 숫자 필드
# 4) 실행 중 tag = 정상 <CLEAN_TAG> (fault tag 아님)
# 5) g007_loopback_health && g007_tls_health → 네 코드 모두 2xx
# 6) D6 probe → D6_HTTP=403 만 PASS (그 외·모호 → BLOCKED, S4 불가) — 본 절 D6
# 7) old trigger unauthorized → non-2xx + delta 0
# 8) 최근 인가 new trigger 성공 증거
# 9) C4=PASS 만 허용. C4=BLOCKED·surface 부재·미실행 → 즉시 G007_FINAL=BLOCKED (S4 불가)
# 10) FAULT_DRILL=PASS 및 fault Release/tag/image 잔존 없음
# 11) tag ruleset 변경 없음(D8) — 이 창에서 ruleset API/UI 미호출

echo 'G007_FINAL=PASS'   # 전 항목 충족 시에만
# 그렇지 않으면:
# echo 'G007_FINAL=BLOCKED'
```

- **C4 특별 규칙:** `C4=BLOCKED`(공유 surface 부재 포함)는 기록이 아니라 **종료 차단**이다. 게이트를 off로 두고 S4를 선언하지 않는다.
- 출력은 반드시 다음 중 한 줄: `G007_FINAL=PASS` | `G007_FINAL=BLOCKED`.
  런북은 이 한 줄만으로 S4 전이/거절을 결정한다.

### G007과 ①②③의 관계

- ① 로컬·② EC2 dry-run은 첫 greenfield 배포 전 회귀 차단용이다.
- 이미 운영 job·host nginx가 있는 점검 창에서는 ①②를 재실행해 운영을 덮어쓰지 않는다.
- 점검 창 검증은 이 절과 server-runbook G007만 따른다.

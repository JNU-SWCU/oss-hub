# 배포 서버 런북 — Jenkins Release 배포 파이프라인 실동작화

이 문서는 배포 서버에서 ADR-002 Jenkins Release 배포 파이프라인을 **처음 실동작**시키는 수동 절차의 단일 소유 런북이다.
파이프라인 정의는 저장소 루트 `Jenkinsfile`이 원본이며 이 런북은 명령을 복제하지 않고 스텝·검증 기준으로 서술한다.
승인 단위·트리거·롤백 계약의 원본은 [ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md), 운영 경계·완료 증거의 원본은 [init-operations](../exec-plan/active/init-operations.md)다.

## 0. 절대 경계 (먼저 읽는다)

- **대상 서버는 오직 하나다.** 이 런북의 모든 접속·명령은 JNU OSS Platform 배포 EC2(리전 `ap-northeast-2`) **한 대에만** 적용한다.
- **Tailscale 망의 다른 호스트(운영 무관 서버 포함)에는 접속하지 않는다.** 이 런북에는 다른 tailnet 호스트로 붙는 절차가 없으며, 추가해서도 안 된다.
- **실제 시크릿·토큰·PAT·공인 IP·인스턴스 ID 등 접근 정보는 이 저장소에 적지 않는다.** 아래 `<...>` 자리표시자는 Notion credentials 페이지에서 실제 값을 조회해 사용한다(§8).

## 1. 표기 규약

- `<INSTANCE_ID>` — 배포 EC2 인스턴스 ID (실제 값: Notion credentials)
- `<EC2_TAILSCALE_HOST>` — 배포 EC2의 Tailscale 호스트명 (실제 값: Notion credentials)
- `<GITHUB_OWNER>/<GITHUB_REPO>` — 배포 대상 저장소 (`Jenkinsfile`의 release 검증 URL 참조)
- `<JENKINS_ADMIN_USER>` — Jenkins 개인 관리자 계정 (실제 값: Notion credentials)

- 각 스텝은 **명령 → 예상 출력 → 검증**의 세 요소로 적는다. 배포판·버전 차이는 스텝 의도를 유지한 채 조정한다.
- 접속 방식은 두 가지 중 하나다: AWS SSM Session Manager 또는 Tailscale SSH. 공인 SSH(22)는 열지 않는다.
- Compose ingress smoke는 `http://127.0.0.1:8081`이다. 공인 TLS smoke는 host nginx 계약([init-operations](../exec-plan/active/init-operations.md) M4, `Jenkinsfile`)을 따른다.

## M1. 서버 접속 (배포 EC2 전용)

```sh
# SSM Session Manager
aws ssm start-session --target <INSTANCE_ID> --region ap-northeast-2
# 또는 Tailscale SSH
ssh ubuntu@<EC2_TAILSCALE_HOST>
```

- 예상 출력: `Starting session with SessionId: ...` 또는 SSH 프롬프트 진입.
- 검증: `hostname` 과 `curl -s http://169.254.169.254/latest/meta-data/instance-id`(IMDS)가 `<INSTANCE_ID>`와 일치하는지 확인해 **대상 서버가 맞는지** 먼저 확인한다. 일치하지 않으면 즉시 종료한다.

## M2. Docker · Jenkins · 빌드 툴체인 설치

파이프라인 executor는 서버 로컬에서 Docker 이미지 빌드와 앱 build(lint/typecheck/test)를 수행하므로 Docker와 Node/pnpm/jq가 모두 필요하다.

```sh
# Docker Engine + compose plugin (Ubuntu)
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin jq
sudo systemctl enable --now docker

# Node 24 + pnpm 11 (corepack)
# (배포판 정책에 맞는 방식으로 Node 24 설치 후)
corepack enable
corepack prepare pnpm@11 --activate

# Jenkins (LTS). 관리 UI는 127.0.0.1:8080에만 bind한다.
# 설치 방식은 조직 표준(패키지 또는 컨테이너)을 따르되, 아래 검증을 통과시킨다.
```

- 예상 출력: 각 설치 명령이 오류 없이 완료.
- 검증:

```sh
docker --version          # Docker version 2x.x.x
docker compose version    # Docker Compose version v2.x.x
node -v                   # v24.x.x
pnpm -v                   # 11.x.x
jq --version              # jq-1.x
sudo ss -ltnp | grep 8080 # Jenkins가 127.0.0.1:8080에만 LISTEN (0.0.0.0:8080이면 안 됨)
```

- Jenkins 관리 UI는 Tailscale/SSM 터널로만 접근한다. 공인 8080 포트는 열지 않는다.

## M3. Credentials · 상태 디렉터리

```sh
# 운영 env를 Jenkins Credentials Store의 secret file로 등록 (UI 또는 JCasC)
#   credential id: oss-hub-production-env
#   ※ 실제 값은 이 저장소에 두지 않는다. Notion credentials → Jenkins Credentials Store로만.

# 상태/백업 디렉터리 (Jenkins 소유, 0700)
sudo install -d -m 700 -o jenkins -g jenkins /var/lib/oss-hub/deploy-state
sudo install -d -m 700 -o jenkins -g jenkins /var/lib/oss-hub/backups
```

`compose.yml`은 아래 키를 `${VAR:?...}`로 요구한다. 하나라도 없으면 compose가 보간 단계에서 중단되며,
`up -d postgres`처럼 서비스 하나만 다루는 명령도 함께 실패한다.
`IMAGE_TAG`를 뺀 전부가 `oss-hub-production-env`에 있어야 한다.
`compose.yml`이 원본이며, 이 표는 그 사본이다 — 목록이 다르면 `compose.yml`을 신뢰한다.

| 키 | 용도 |
| --- | --- |
| `IMAGE_TAG` | backend·frontend 이미지 태그. **env 파일에 두지 않는다** — Jenkins가 릴리스 커밋 SHA로 주입한다(`Jenkinsfile`). 수동으로 compose를 돌릴 때만 셸에서 지정한다 |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | postgres 서비스 자격증명 |
| `DATABASE_URL` | postgres 서비스 DNS를 가리키는 연결 문자열 |
| `SESSION_SECRET` | 세션 서명 시크릿 |
| `TEAM_JOIN_CODE_SECRET` | 팀 참가 코드 서명 시크릿 |
| `FRONTEND_URL` | OAuth 콜백 파생 등에 쓰는 프런트엔드 base URL |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth 로그인 앱 |
| `GITHUB_COLLECTION_APP_ID` / `GITHUB_APP_ORG` / `GITHUB_COLLECTION_APP_PRIVATE_KEY` | GitHub 활동 수집 App |
| `SUBMISSION_FILE_S3_ACCESS_KEY_ID` / `SUBMISSION_FILE_S3_SECRET_ACCESS_KEY` | 운영자가 생성. `compose.yml`에서 MinIO root 자격증명으로도 같이 쓴다 |
| `GMAIL_SENDER` / `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` / `GMAIL_OAUTH_REFRESH_TOKEN` | 마감 알림 메일 발신 (production 부팅 필수 4종) |

`SUBMISSION_FILE_S3_ACCESS_KEY_ID`·`SUBMISSION_FILE_S3_SECRET_ACCESS_KEY`의 실제 값은 이 저장소에 두지 않는다.
`compose.yml`에 env 키를 추가하거나 지우면 이 표도 같은 PR에서 갱신한다.

### 기본값이 있는 저장소 키

아래 4개는 이 스택의 MinIO 토폴로지가 결정하는 값이라 `compose.yml`이 기본값을 갖는다.
**평소에는 `oss-hub-production-env`에 넣지 않는다** — 넣으면 기본값과 어긋날 여지만 생긴다.

| 키 | 기본값 | 비고 |
| --- | --- | --- |
| `SUBMISSION_FILE_S3_ENDPOINT` | `http://minio:9000` | compose 내부 DNS. MinIO는 외부 노출하지 않는다 |
| `SUBMISSION_FILE_S3_REGION` | `us-east-1` | MinIO는 무시하지만 SDK가 빈 값이 아니길 요구한다 |
| `SUBMISSION_FILE_S3_BUCKET` | `oss-hub-submission-files` | `minio-bucket` 서비스가 기동 시 자동 생성한다. `backend`와 `minio-bucket` 양쪽 기본값이 같아야 한다 |
| `SUBMISSION_FILE_S3_FORCE_PATH_STYLE` | `true` | MinIO는 path-style만 받는다 |

관리형 S3로 옮길 때는 이 4개를 env에 지정한다. 애플리케이션 코드는 바꾸지 않는다.
**전환 후에는 백엔드 컨테이너에 실제로 반영된 엔드포인트를 확인한다** — 키 이름을 틀리면 오류 없이
기본값이 먹어 업로드가 조용히 로컬 MinIO로 계속 간다.

```bash
docker compose --env-file "$OSS_HUB_ENV_FILE" exec backend printenv SUBMISSION_FILE_S3_ENDPOINT
```

- 검증:

```sh
stat -c '%a %U %G %n' /var/lib/oss-hub/deploy-state /var/lib/oss-hub/backups
# 700 jenkins jenkins /var/lib/oss-hub/deploy-state
# 700 jenkins jenkins /var/lib/oss-hub/backups
```

- Credentials Store에 `oss-hub-production-env`가 보이고, secret file 값이 로그·workspace에 출력되지 않는지 확인한다.

## M4. 파라미터화 Jenkins job

`Jenkinsfile`은 `RELEASE_ACTION`, `RELEASE_TAG` 두 string 파라미터와 `oss-hub-production` agent label을 사용한다.

- Pipeline job을 SCM(`Jenkinsfile`) 기반으로 생성한다.
- 파라미터 `RELEASE_ACTION`(default 빈 값), `RELEASE_TAG`(default 빈 값)를 정의한다.
- Docker 권한을 가진 executor에 `oss-hub-production` label을 부여하고, 이 job과 승인된 운영자 외 작업을 배치하지 않는다. `disableConcurrentBuilds()`는 `Jenkinsfile`이 강제한다.
- 자동 트리거 계약(GitHub Actions `deploy.yml` → Jenkins `buildWithParameters`)은 [ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)·[init-operations](../exec-plan/active/init-operations.md) M2가 원본이다.
- **첫 e2e 검증은 파라미터를 손으로 입력해 job을 수동 트리거한다.** 자동 트리거 설정 완료 여부와 별개로, 수동 경로는 동일 `RELEASE_ACTION`·`RELEASE_TAG` 계약을 재현한다.

- 검증: 파라미터 없이 job을 1회 빌드하면 `RUN_MODE=main`으로 lint/typecheck/test/build 검증만 수행하고 production을 건드리지 않는다(콘솔 로그로 확인).

## M5. GitHub API 호출 준비

`Jenkinsfile`의 release·승인 검증은 GitHub API(`releases/latest`, `#199` 댓글)를 호출한다. 공개 저장소라 미인증(60/hr)으로도 동작한다.

- read-only PAT를 Jenkins Credentials Store에 **준비·문서화**한다(레이트리밋/향후 private 대비).
- **`Jenkinsfile`에 인증 헤더를 넣는 코드 변경은 이 런북 범위가 아니다.** 현재 파이프라인은 미인증 curl을 사용한다.
- PAT 실제 값은 저장소·PR·로그에 남기지 않는다. Notion credentials → Jenkins Credentials Store로만.

## M6. 배포 전 단계 검증 (로컬 → EC2 드라이런)

첫 Release e2e 전에 [pre-deploy-verify](./pre-deploy-verify.md)의 ① 로컬 랩탑 검증과 ② 배포 EC2 서버-로컬 드라이런을 순서대로 통과시킨다. 앞 단계가 통과해야 다음으로 넘어간다.

- 검증: ②에서 배포 EC2 서버-로컬로 이미지 빌드 + `docker compose up` + `http://127.0.0.1:8081/`·`/api/v1/health` smoke가 1회 성공.

## M7. 첫 Release 수동 트리거 e2e

1. main에 있는 exact commit으로 full GitHub Release(예: `v0.1.0`)를 발행한다(`draft=false`, `prerelease=false`, tag SHA가 main ancestry).
2. #199에 같은 tag·full SHA의 @GoBeromsu `RELEASE_ACCEPT role=PM`을 남긴다([ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)).
3. M4 job을 **수동 트리거**하며 파라미터를 입력한다: `RELEASE_ACTION=published`, `RELEASE_TAG=<tag>`.
4. 파이프라인이 순서대로 수행되는지 콘솔 로그로 확인한다: exact SHA detached checkout → build/test → PostgreSQL 기동 + `pg_dump` 백업 → front/back 이미지 서버 로컬 빌드 → `prisma migrate deploy` → `up -d --no-build --wait` → loopback Compose ingress smoke → 공인 IP TLS smoke.

- 예상 출력: loopback·TLS smoke가 모두 HTTP 200. `current-release` 상태 파일에 `<tag> <40-hex-sha>` 기록.
- 검증:

```sh
sudo cat /var/lib/oss-hub/deploy-state/current-release   # <tag> <sha>
curl -fsS http://127.0.0.1:8081/            > /dev/null && echo "root OK"
curl -fsS http://127.0.0.1:8081/api/v1/health > /dev/null && echo "health OK"
# 공인 TLS smoke는 host nginx·인증서 계약이 준비된 뒤에 Jenkinsfile과 동일 경로로 확인한다.
```

- **no-op 재확인**: 동일 tag를 다시 전달(job 재트리거)하면 상태 파일 비교로 성공 no-op 처리되어 재배포가 일어나지 않는지 확인한다.
- 실패 시: `PREV_TAG`가 없는 첫 배포는 자동 rollback 대상이 없다. [init-operations](../exec-plan/active/init-operations.md) 복구 절차대로 로그·백업을 보존하고 수동 복구한다. `down -v`는 사용하지 않는다.

## 8. Notion에 기록할 접근 정보 체크리스트 (aside 위임)

아래 항목의 **실제 값**은 이 저장소가 아니라 **Notion credentials 페이지**가 원본이다. Notion 기록 작업은 craft-skills aside에 위임한다(이 저장소·PR·로그에는 항목명만 남기고 값은 남기지 않는다).

- [ ] 배포 EC2 인스턴스 ID / Tailscale 호스트명 / 접속 방법(SSM·Tailscale)
- [ ] Jenkins 개인 관리자 계정(공용 계정 공유 금지)
- [ ] `oss-hub-production-env` secret file의 항목 목록(값 제외)
- [ ] GitHub read-only PAT의 소재·권한 범위(값 제외)
- [ ] 상태/백업 디렉터리 경로와 소유·권한 정책
- [ ] host nginx·공인 TLS·Jenkins 원격 트리거 경로 설정 소재(값 제외)

## 9. 오늘 범위 밖 (follow-up / 별도 PR)

- **자동 트리거 live 연결 검증** (GitHub Actions `deploy.yml` → Jenkins `buildWithParameters` e2e) — 수동 M7과 별도 확인.
- **`Jenkinsfile` GitHub API 인증(PAT)** 적용(코드 변경) — follow-up.
- **host nginx TLS/IP 인증서 live 운영 점검** — 계약 원본은 [init-operations](../exec-plan/active/init-operations.md) M4.

## G007. 점검 창 — legacy → v2 전환 (canonical sequence)

이 절은 [#305](https://github.com/JNU-SWCU/oss-hub/issues/305) G007 점검 창의 **순서·상태 전이 원본**이다.
검증 probe 상세는 [pre-deploy-verify](./pre-deploy-verify.md) G007 절이 원본이며, 여기서는 통과/실패 판정만 적는다.
모든 production 변이(게이트·nginx·Jenkins job·Release)는 **사람 승인 뒤에만** 수행한다.
이 문서는 절차를 서술할 뿐, 어떤 production 스텝이 이미 실행됐다는 주장을 하지 않는다.
tag ruleset 생성·변경·검증·rollback은 범위 밖이다(D8) — 태그 조작 방어는 `RELEASE_ACCEPT role=PM` 승인 바인딩이 담당한다([ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)).
D6(제출 파일 object backup 간극으로 업로드 경로 fail-closed)는 이 점검 창에서 **열지 않고 닫힌 채 유지**한다.

### G007 표기

- `<ACTIVATION_PR>` — root `Jenkinsfile`을 검토된 v2 계약으로 올리는 활성화 PR 번호
- `<PR7>` — 파라미터 없는 신 트리거 경로(`POST /job/oss-hub-release-cd/build`)와 게이트 연동 코드를 올리는 PR 번호
- `<LEGACY_JENKINSFILE_SHA>` — C3가 고정하는 전환 직전 root `Jenkinsfile`의 immutable 40-hex commit SHA
- `<FROZEN_HEAD_REF_OID_ACTIVATION>` / `<FROZEN_HEAD_REF_OID_PR7>` — 각 PR의 freeze 시점 `headRefOid`(merge commit SHA가 아님)
- `<FROZEN_RUNNING_TAG>` / `<FROZEN_RUNNING_SHA>` — freeze 시점 실행 중 frontend·backend 공통 release tag와 commit SHA(없으면 greenfield로 기록)
- `<OLD_TRIGGER_PATH>` — `POST /job/oss-hub-release-cd/buildWithParameters`
- `<NEW_TRIGGER_PATH>` — `POST /job/oss-hub-release-cd/build`
- `<HOST_NGINX_CONF_SRC>` — 저장소 `deploy/host-nginx/oss-hub.conf`(dual-route 또는 new-only 리뷰본)
- `<HOST_NGINX_CONF_DST>` — 배포 서버 host nginx conf 설치 경로(실제 값은 Notion credentials)
- `<BACKUP_DIR>` — 운영 backup 디렉터리(실제 값은 Notion credentials; 권한·소유 정책은 M3)
- `<C3_JOB_NAME>` — legacy 검증 전용 Jenkins job 이름(운영 `oss-hub-release-cd`와 분리)
- `<JENKINS_UI>` — Tailscale/SSM 터널로만 여는 Jenkins 관리 UI(`127.0.0.1:8080`)
- 승인 토큰은 ADR-005 exact-head 형식만 쓴다: 현재 `headRefOid`·base ref·base SHA에 고정된 `MERGE_READY`와 배포 계약 경로용 `@GoBeromsu` `PM_ACCEPT`.
- freeze/대조 대상은 항상 PR `headRefOid`다. merge commit SHA로 대체하지 않는다.

### G007 상태표 (S0–S4)

| 상태 | Jenkins 계약 | host nginx 공개 트리거 | `DEPLOY_TRIGGER_ENABLED` | 비고 |
| --- | --- | --- | --- | --- |
| S0 | legacy(root `Jenkinsfile` + job 파라미터) | old path만 또는 전환 전 구성 | `false` | 진입 기본. C3 준비·baseline lock |
| S1 | legacy | dual(old+new location) | `false` | dual-route nginx 설치 후. new path는 수신만·게이트 off |
| S2 | v2(root `Jenkinsfile` + job 파라미터 제거) | dual | `false` | 활성화 병합 후. 자동 배포 없음 |
| S3 | v2 | dual | `true`(실패 시 즉시 `false`로 강제) | PR-7 병합·게이트 on 후 실증 구간(D7 적용) |
| S4 | v2 | new-only | `true` | old path 회수 완료. 점검 창 종료 조건 |

### G007 불변식

- 점검 창 안에서는 ruleset 작업을 하지 않는다(D8).
- 활성화 PR과 `<PR7>` 병합 직전에는 **그 순간의** exact-head `MERGE_READY`+`PM_ACCEPT`가 필요하다.
- 활성화가 main을 바꾼 뒤에는 `<PR7>` 마커를 **반드시 재발급**한 다음 병합한다.
- step 6 진입 이후 실패는 legacy 복원이 아니라 게이트 off + v2 fix-forward다(D7).
- step 7 실패 시 nginx만 dual-route로 되돌리며 legacy Jenkins로 내리지 않는다.
- C4(`N=120`) 격리 fixture는 **공유 pruning surface가 생기기 전까지 blocked**로 남기고, 그 전에는 실 backup 디렉터리에서 retention을 실행하지 않는다.
- D6은 닫힌 채 유지한다 — 제출 업로드 차단 해제·`minio_data` backup 편입은 이 창 범위 밖이다.

### Step 0 — 대상·PR 신원 freeze (owner: @GoBeromsu)

- 명령/UI:
  - `gh api repos/<GITHUB_OWNER>/<GITHUB_REPO>/pulls/<ACTIVATION_PR> --jq .head.sha` → `<FROZEN_HEAD_REF_OID_ACTIVATION>`
  - `gh api repos/<GITHUB_OWNER>/<GITHUB_REPO>/pulls/<PR7> --jq .head.sha` → `<FROZEN_HEAD_REF_OID_PR7>`
  - 배포 EC2에서 실행 중 frontend·backend 이미지 tag/label을 읽어 `<FROZEN_RUNNING_TAG>`·`<FROZEN_RUNNING_SHA>` 기록(없으면 `greenfield`)
  - 운영 job SCM이 root `Jenkinsfile`인지, 파라미터가 legacy 계약인지 `<JENKINS_UI>`에서 확인
- 예상 결과: 세 신원(활성화 headRefOid, PR-7 headRefOid, running tag/SHA 또는 greenfield)이 문서화된 freeze 세트와 비트 단위로 일치하고 상태=S0.
- 실패 전이: 불일치·모호하면 **즉시 abort**, S0 유지, step 1로 진행하지 않는다.

### Step 1 — 자동 트리거 차단·대기열 비움 (owner: @GoBeromsu)

- 명령/UI:
  - GitHub repo variable: `DEPLOY_TRIGGER_ENABLED=false` (Settings → Secrets and variables → Actions → Variables)
  - `<JENKINS_UI>` → `oss-hub-release-cd` 및 관련 executor: running builds = 0, buildable queue = 0
- 예상 결과: 변수 값이 문자열 `false`이고, 해당 job running=0·queue=0.
- 실패 전이: 변수 변경 실패 또는 잔여 build/queue가 있으면 abort, S0 유지. 강제 abort로 타 job을 죽이지 않는다.

### Step 2 — baseline lock + 비인가 트리거 영-부작용 (owner: @GoBeromsu)

- 명령/UI: [pre-deploy-verify](./pre-deploy-verify.md) «G007 baseline·probe» 절차를 그대로 실행한다.
  - loopback `http://127.0.0.1:8081/`·`/api/v1/health` 및 공인 TLS 동일 경로 상태를 baseline으로 잠근다.
  - D6 닫힘(제출 업로드 fail-closed)을 baseline에 포함한다.
  - 인증 없는(또는 잘못된) old/new trigger POST probe를 각 1회 보낸다.
- 예상 결과: probe HTTP 상태가 non-2xx이고, Jenkins build number·running·queue·job log byte/mtime 증가가 **모두 0**.
- 실패 전이: 2xx 수신 또는 delta≠0이면 abort, S0 유지, dual nginx를 설치하지 않는다.

### Step 3 — C3 immutable legacy 검증 job (owner: Jenkins admin + @GoBeromsu)

- 명령/UI (`<JENKINS_UI>`):
  - 운영 job과 **별도** Pipeline job `<C3_JOB_NAME>` 생성
  - SCM을 저장소 root로 두되 **branch/commit을 `<LEGACY_JENKINSFILE_SHA>`(40-hex)에 고정** — floating branch 금지
  - 파라미터 없이 Build Now 1회
  - 실행 전후 서비스 snapshot(실행 중 이미지 tag/SHA, compose ps) 비교
- 예상 결과: `<C3_JOB_NAME>`이 SUCCESS이고, 서비스 snapshot이 변경되지 않으며, job 정의가 여전히 같은 40-hex에 pin.
- 실패 전이: 실패·snapshot 변경·pin 유실 시 abort, S0 유지. 운영 job을 C3로 대체하지 않는다.

### Step 4 — dual-route host nginx (owner: @GoBeromsu) → S1

- 명령/UI:
  - 리뷰된 dual-route `<HOST_NGINX_CONF_SRC>`를 `<HOST_NGINX_CONF_DST>`에 설치
  - `sudo nginx -t` → `sudo systemctl reload nginx`(또는 조직 표준 reload)
  - active conf에 old·new location이 모두 있는지 확인
  - step 2와 동일한 locked probe 재실행([pre-deploy-verify](./pre-deploy-verify.md))
- 예상 결과: `nginx -t` ok, reload 성공, dual location active, unauthorized probe는 여전히 non-2xx + delta 0, 상태=S1.
- 실패 전이: 직전 conf 백업본으로 복구 후 reload, **S0 복귀**. C3·legacy job은 그대로 둔다.

### Step 5 — 활성화 병합·job 파라미터 제거 (owner: @GoBeromsu) → S2

- 명령/UI:
  - `<ACTIVATION_PR>`의 **현재** `headRefOid`가 `<FROZEN_HEAD_REF_OID_ACTIVATION>`과 같은지 재확인(바뀌었으면 freeze 갱신 + 마커 재발급)
  - exact-head `MERGE_READY` + `@GoBeromsu` `PM_ACCEPT` 확인 후 병합(admin bypass 금지)
  - `<JENKINS_UI>`에서 운영 job `oss-hub-release-cd`의 `RELEASE_ACTION`·`RELEASE_TAG` 파라미터 정의 제거
  - job SCM은 main/root `Jenkinsfile` 유지(별도 브랜치 pin 금지)
  - 게이트는 `false` 유지
- 예상 결과: main이 활성화 headRefOid를 조상으로 포함하고, 운영 job이 파라미터 없는 v2 계약이며, 상태=S2.
- 실패 전이: step 6 진입 전이면 C3 pin(`<LEGACY_JENKINSFILE_SHA>`)으로 운영 job SCM을 되돌리고 파라미터를 복구해 **S1 또는 S0**으로 복귀. 게이트를 켜지 않는다.

### Step 6 — PR-7·게이트 on·배포 실증·C4·fault drill (owner: @GoBeromsu) → S3 (D7 시작)

step 6 **진입 시점부터 D7**: 이후 실패는 legacy 복원 금지. 즉시 `DEPLOY_TRIGGER_ENABLED=false` 후 v2 fix-forward만 허용한다.

1. **PR-7 마커 재발급·병합**
   - 명령/UI: 활성화 병합 후 `<PR7>`의 새 `headRefOid`를 읽고, exact-head `MERGE_READY`+`PM_ACCEPT`를 **재발급**한 뒤 병합.
   - 예상 결과: PR-7이 현재 headRefOid 기준으로 병합됨.
   - 실패 전이: 게이트 off 유지, S2 고정, fix-forward PR만 허용.
2. **게이트 enable**
   - 명령/UI: `DEPLOY_TRIGGER_ENABLED=true`.
   - 예상 결과: 변수 `true`, 상태=S3.
   - 실패 전이: 변수를 `false`로 되돌리고 S2 fix-forward.
3. **정상 Release 배포**
   - 명령/UI: 승인된 full Release + #199 `@GoBeromsu` `RELEASE_ACCEPT role=PM tag=<tag> head=<sha>` 후 `release.yml`/`deploy.yml` 경로로 트리거(또는 동등한 신 경로 수동 POST).
   - 예상 결과: 신 경로로 job이 성공하고 loopback·TLS `/`·`/api/v1/health`가 2xx, 실행 중 tag가 대상 Release.
   - 실패 전이: 게이트 off → v2 fix-forward(D7). legacy job/C3로 운영을 되돌리지 않는다.
4. **독립 no-op 배포**
   - 명령/UI: 동일 latest Release로 신 경로 트리거 1회 재전달.
   - 예상 결과: 성공 no-op(재빌드·재deploy 없음)이 로그로 확인됨.
   - 실패 전이: D7(게이트 off + fix-forward).
5. **C4 N=120 격리 retention fixture**
   - 명령/UI: [pre-deploy-verify](./pre-deploy-verify.md) «G007 C4» 실행.
   - 예상 결과: 공유 pruning surface가 있을 때만, 운영 `<BACKUP_DIR>`과 **분리된** 121-item synthetic 디렉터리에서 동일 구현으로 120개 보존·fixture 삭제·실 backup name/byte inventory 전후 일치.
   - 차단: 공유 pruning surface가 없으면 C4는 **blocked**로 기록하고 실 backup에서 retention을 실행하지 않는다. C4 blocked만으로 step 6 전체를 자동 abort하지는 않으나 S4 종료 조건에서는 미해소로 남는다.
   - 실패 전이(surface 존재 시 inventory 불일치): D7.
6. **controlled reversible fault drill**
   - 명령/UI: 고의 fault Release를 신 경로로 배포 → 즉시 정상 tag로 revert 트리거 → 한 단계 `PREV_TAG` rollback 관찰 → fault Release·tag·image 정리 → 깨끗한 정상 Release 재배포.
   - 예상 결과: rollback 1회가 관찰되고 fault 산출물이 제거되었으며 최종 실행 중 tag가 정상 Release.
   - 실패 전이: D7. step 7의 dual-only nginx 복구와 혼동하지 않는다.

### Step 7 — new-only host nginx (owner: @GoBeromsu) → S4 직전

- 명령/UI:
  - old path unauthorized probe를 다시 잠가 non-2xx + delta 0을 확인([pre-deploy-verify](./pre-deploy-verify.md))
  - new-only conf 설치 → `sudo nginx -t` → reload
  - old location 부재·new location 존재를 active conf에서 확인
  - 인가된 신 경로 트리거 1회 성공(no-op 또는 정상) 확인
- 예상 결과: old path 영-부작용, new-only active, 게이트 `true`, Jenkins는 v2 유지.
- 실패 전이: 게이트를 `false`로 두고 **dual-route nginx만** 복구(S3 쪽). legacy Jenkinsfile·파라미터 job으로 내리지 않는다(D7).

### Step 8 — S4 종료 검증 (owner: @GoBeromsu)

- 명령/UI: [pre-deploy-verify](./pre-deploy-verify.md) «G007 S4 checklist»를 순서대로 평가한다.
- 예상 결과(모두 충족 시 상태=S4, 점검 창 종료):
  - `DEPLOY_TRIGGER_ENABLED=true`
  - 운영 job 파라미터 없음, running=0, queue=0
  - 깨끗한 정상 Release tag가 실행 중
  - loopback·TLS health 2xx
  - D6 닫힘 유지
  - old trigger 영-부작용(non-2xx + delta 0)
  - 최근 인가된 new trigger 성공
  - C4 증거가 유효하거나, 공유 pruning surface 부재로 blocked인 사실이 명시됨
  - fault Release/tag/image 잔존 없음
  - ruleset 변경 없음(D8)
- 실패 전이: 미충족 항목을 고치기 위해 게이트 off 후 v2 fix-forward. S4를 선언하지 않는다.

### G007 종료 후

- C3 job은 보관하되 운영 트리거 경로에 연결하지 않는다. 제거는 별도 승인 작업이다.
- follow-up(공유 pruning surface·C4 실운전·D6 해제)은 이 절 밖 high-risk 작업으로 연다.
- 팀 상태 링크·미해소 전제만 [TEAM-STATE](../handoff/TEAM-STATE.md)에 남긴다.

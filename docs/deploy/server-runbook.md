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
검증 측정·판정·`G007_FINAL` 결과 원본은 [pre-deploy-verify G007](./pre-deploy-verify.md#g007-점검-창-검증-상세-sequence-비소유)이다.
런북은 그 결과 한 줄(`G007_FINAL=PASS|BLOCKED`)만 소비하고 S-상태 전이를 소유한다. 측정 체크리스트를 여기서 복제하지 않는다.
모든 production 변이(게이트·nginx·Jenkins job·Release)는 **사람 승인 뒤에만** 수행한다.
이 문서는 절차를 서술할 뿐, 어떤 production 스텝이 이미 실행됐다는 주장을 하지 않는다.
tag ruleset 생성·변경·검증·rollback은 범위 밖이다(D8) — 태그 조작 방어는 `RELEASE_ACCEPT role=PM` 승인 바인딩이 담당한다([ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md), [ADR-005](../decisions/ADR-005-agent-driven-review-cycle.md)).
D6(제출 파일 object backup 간극으로 업로드 경로 fail-closed)는 이 점검 창에서 **열지 않고 닫힌 채 유지**한다.

### G007 표기

- `<ACTIVATION_PR>` — root `Jenkinsfile`을 검토된 v2 계약으로 올리는 활성화 PR 번호
- `<PR7>` — 파라미터 없는 신 트리거 경로(`POST /job/oss-hub-release-cd/build`)와 게이트 연동 코드를 올리는 PR 번호
- `<LEGACY_JENKINSFILE_SHA>` — C3가 고정하는 전환 직전 root `Jenkinsfile`의 immutable 40-hex commit SHA
- `<FROZEN_HEAD_REF_OID_ACTIVATION>` / `<FROZEN_HEAD_REF_OID_PR7>` — 각 PR의 freeze 시점 `headRefOid`(merge commit SHA가 아님)
- `<FROZEN_RUNNING_TAG>` / `<FROZEN_RUNNING_SHA>` — freeze 시점 실행 중 frontend·backend 공통 release tag와 commit SHA(없으면 greenfield로 기록)
- `<OLD_TRIGGER_PATH>` — `POST /job/oss-hub-release-cd/buildWithParameters`
- `<NEW_TRIGGER_PATH>` — `POST /job/oss-hub-release-cd/build`
- `<HOST_NGINX_CONF_SRC_DUAL>` — 저장소 dual-route host nginx conf 리뷰본 경로(예: `deploy/host-nginx/oss-hub.conf` dual 변형)
- `<HOST_NGINX_CONF_SRC_NEW_ONLY>` — 저장소 new-only host nginx conf 리뷰본 경로
- `<HOST_NGINX_CONF_DST>` — 배포 서버 host nginx conf 설치 경로(실제 값은 Notion credentials)
- `<HOST_NGINX_CONF_BACKUP>` — reload 직전 conf 백업 경로(운영자 로컬/서버 임시; 저장소에 실경로 금지)
- `<BACKUP_DIR>` — 운영 backup 디렉터리(실제 값은 Notion credentials; 권한·소유 정책은 M3)
- `<C3_JOB_NAME>` — legacy 검증 전용 Jenkins job 이름(운영 `oss-hub-release-cd`와 분리)
- `<JENKINS_UI>` — Tailscale/SSM 터널로만 여는 Jenkins 관리 UI(`127.0.0.1:8080`)
- `<PUBLIC_DEPLOY_BASE>` — 공인 HTTPS 배포 base(호스트·IP 실값은 저장소에 쓰지 않음)
- `<DEPLOYER_USER>` / `<DEPLOYER_API_TOKEN>` — 신 경로 전용 deployer 자격(값 저장소 금지; Credentials/Notion)
- `<FAULT_TAG>` — full SemVer fault Release tag(예: `v0.0.0-g007-fault.1`; 점검 창 종료 전 삭제)
- `<CLEAN_TAG>` — fault 정리 후 최종 정상 full SemVer Release tag
- `<FAULT_BRANCH>` — 검토된 가역 fault 전용 단기 브랜치 이름(main에 직접 force-push 금지)
- 승인 토큰은 ADR-005 exact-head 형식만 쓴다: 현재 `headRefOid`·base ref·base SHA에 고정된 `MERGE_READY`와 배포 계약 경로용 @GoBeromsu `PM_ACCEPT`. production Release는 `#199`의 @GoBeromsu `RELEASE_ACCEPT role=PM tag=<tag> head=<sha>` 한 건만 유효하다(`TECH_LEAD`·`OVERRIDE` 폐지).
- freeze/대조 대상은 항상 PR `headRefOid`다. merge commit SHA로 대체하지 않는다.

### G007 상태표 (S0–S4)

| 상태 | Jenkins 계약 | host nginx 공개 트리거 | `DEPLOY_TRIGGER_ENABLED` | 비고 |
| --- | --- | --- | --- | --- |
| S0 | legacy(root `Jenkinsfile` + job 파라미터) | old path만 또는 전환 전 구성 | `false` | 진입 기본. C3 준비·baseline lock |
| S1 | legacy | dual(old+new location) | `false` | dual-route nginx 설치 후. new path는 수신만·게이트 off |
| S2 | v2(root `Jenkinsfile` + job 파라미터 제거) | dual | `false` | 활성화 병합 후. 자동 배포 없음 |
| S3 | v2 | dual | `true`(실패 시 즉시 `false`로 강제) | PR-7 병합·게이트 on 후 실증 구간(D7 적용) |
| S4 | v2 | new-only | `true` | old path 회수 완료. **C4 PASS + `G007_FINAL=PASS` 필수**. 점검 창 종료 조건 |

### G007 불변식

- 점검 창 안에서는 ruleset 작업을 하지 않는다(D8).
- 활성화 PR과 `<PR7>` 병합 직전에는 **그 순간의** exact-head `MERGE_READY`+`PM_ACCEPT`가 필요하다.
- 활성화가 main을 바꾼 뒤에는 `<PR7>` 마커를 **반드시 재발급**한 다음 병합한다.
- step 6 진입 이후 실패는 legacy 복원이 아니라 게이트 off + v2 fix-forward다(D7).
- step 7 실패 시 nginx만 dual-route로 되돌리며 legacy Jenkins로 내리지 않는다.
- **C4(`N=120`) same-code 격리 fixture PASS는 S4 진입 필수 조건이다.** 공유 pruning surface가 없거나 fixture가 PASS가 아니면 `G007_FINAL=BLOCKED`, `DEPLOY_TRIGGER_ENABLED=false`, **S4 선언 금지**. 실 backup 디렉터리에서 retention을 실행하지 않는다.
- D6은 닫힌 채 유지한다 — 제출 업로드 차단 해제·`minio_data` backup 편입은 이 창 범위 밖이다.
- 측정 결과의 단일 소비 형식은 pre-deploy-verify가 출력하는 `G007_FINAL=PASS` 또는 `G007_FINAL=BLOCKED` 한 줄이다. 런북은 이 값으로만 종료 전이를 한다.

### Step 0 — 대상·PR 신원 freeze (owner: @GoBeromsu)

- 명령/UI:

```sh
# PR headRefOid freeze (merge SHA 금지)
gh api "repos/<GITHUB_OWNER>/<GITHUB_REPO>/pulls/<ACTIVATION_PR>" --jq .head.sha
# → 출력 40-hex를 <FROZEN_HEAD_REF_OID_ACTIVATION>에 기록
gh api "repos/<GITHUB_OWNER>/<GITHUB_REPO>/pulls/<PR7>" --jq .head.sha
# → 출력 40-hex를 <FROZEN_HEAD_REF_OID_PR7>에 기록

# 실행 중 frontend·backend 이미지 tag / image id / labels (배포 EC2)
docker ps --filter label=com.docker.compose.project=oss-hub \
  --filter name=frontend --filter name=backend \
  --format '{{.Names}} {{.ID}} {{.Image}} {{.Status}}'
docker inspect --format '{{.Name}} image={{.Image}} restartCount={{.RestartCount}} labels={{json .Config.Labels}}' \
  $(docker ps -q --filter label=com.docker.compose.project=oss-hub) | sort
# → 공통 release tag·commit SHA를 <FROZEN_RUNNING_TAG>·<FROZEN_RUNNING_SHA>에 기록.
#    컨테이너 부재면 둘 다 문자열 greenfield 로 기록.
```

  - `<JENKINS_UI>` → 좌측 job 목록 → `oss-hub-release-cd` → **Configure**:
    - **Pipeline → Definition** = `Pipeline script from SCM`
    - **SCM** = Git, **Repository URL** = 이 저장소, **Script Path** = `Jenkinsfile`(root)
    - **This project is parameterized** 체크, 파라미터 이름 `RELEASE_ACTION`(String), `RELEASE_TAG`(String) 존재
- 예상 결과: 세 신원(활성화 headRefOid, PR-7 headRefOid, running tag/SHA 또는 `greenfield`)이 문서화된 freeze 세트와 비트 단위로 일치하고 상태=S0.
- 실패 전이: 불일치·모호·Jenkins Configure 불일치면 **즉시 abort**, S0 유지, step 1로 진행하지 않는다.

### Step 1 — 자동 트리거 차단·대기열 비움 (owner: @GoBeromsu)

- 명령/UI:
  - GitHub → 저장소 → **Settings** → **Secrets and variables** → **Actions** → **Variables** 탭 → `DEPLOY_TRIGGER_ENABLED` 행 → **Edit** → Value 필드를 정확히 문자열 `false` → **Update variable**.
  - 확인:

```sh
gh variable list --repo "<GITHUB_OWNER>/<GITHUB_REPO>" --jq '.[] | select(.name=="DEPLOY_TRIGGER_ENABLED") | .value'
# 예상 한 줄: false
```

  - `<JENKINS_UI>` → `oss-hub-release-cd` → **Build History** 상단 상태와 좌측 executor/**Build Queue**:
    - running builds = 0
    - buildable queue items for this job = 0
- 예상 결과: 변수 값이 문자열 `false`이고, 해당 job running=0·queue=0.
- 실패 전이: 변수 변경 실패 또는 잔여 build/queue가 있으면 abort, S0 유지. 강제 abort로 타 job을 죽이지 않는다.

### Step 2 — baseline lock + 비인가 트리거 영-부작용 (owner: @GoBeromsu)

- 명령/UI: [pre-deploy-verify](./pre-deploy-verify.md) «G007 baseline·probe» 절차를 **그대로** 실행하고 그 절이 출력하는 판정 한 줄을 기록한다.
- 예상 결과: pre-deploy-verify baseline·probe 판정 = PASS(비인가 probe non-2xx + build/running/queue/log delta 전부 0, D6 닫힘 관측 포함).
- 실패 전이: 판정 ≠ PASS이면 abort, S0 유지, dual nginx를 설치하지 않는다.

### Step 3 — C3 immutable legacy 검증 job (owner: Jenkins admin + @GoBeromsu)

- 명령/UI:
  1. 측정 전 snapshot — [pre-deploy-verify](./pre-deploy-verify.md) «G007 C3» **before** 블록 실행, 출력 다이제스트/코드를 기록.
  2. `<JENKINS_UI>` → **New Item** → item name = `<C3_JOB_NAME>`(운영 `oss-hub-release-cd`와 **다른** 이름) → type **Pipeline** → **OK**.
  3. Configure:
     - **Definition** = `Pipeline script from SCM`
     - **SCM** = Git, Repository URL = 이 저장소
     - **Branches to build → Branch Specifier** = 정확히 `refs/heads/main`가 아니라 **commit pin**: `<LEGACY_JENKINSFILE_SHA>`(40-hex). UI가 commit을 직접 받지 않으면 Specifier에 40-hex full SHA를 넣고 floating branch 이름만 두지 않는다.
     - **Script Path** = `Jenkinsfile`
     - **This project is parameterized** = **unchecked**(파라미터 없음)
     - 운영 job과 Credentials id·트리거 URL·remote build 설정을 공유하지 않는다.
  4. **Save** → **Build Now** 정확히 1회.
  5. 측정 후 snapshot — pre-deploy-verify «G007 C3» **after** 블록 실행 후 전후 비교 판정을 기록.
- 예상 결과: `<C3_JOB_NAME>` 콘솔 결과 = `SUCCESS`; pre-deploy-verify C3 판정 = PASS(컨테이너 ID·image ID·restartCount 불변·restart delta 0, loopback·TLS health 불변 2xx, pin SHA 유지).
- 실패 전이: SUCCESS 아님·C3 판정 ≠ PASS·pin 유실 시 abort, S0 유지. 운영 job을 C3로 대체하지 않는다.

### Step 4 — dual-route host nginx (owner: @GoBeromsu) → S1

- 명령/UI:

```sh
# 1) 직전 conf 백업 (실경로는 placeholder)
sudo cp -a "<HOST_NGINX_CONF_DST>" "<HOST_NGINX_CONF_BACKUP>"

# 2) 리뷰된 dual-route conf 설치
sudo cp -a "<HOST_NGINX_CONF_SRC_DUAL>" "<HOST_NGINX_CONF_DST>"

# 3) 문법 검사 후 reload
sudo nginx -t
sudo systemctl reload nginx

# 4) active conf에 old·new location 존재 확인 (둘 다 exit 0)
sudo nginx -T 2>/dev/null | grep -F "location = /job/oss-hub-release-cd/buildWithParameters"
sudo nginx -T 2>/dev/null | grep -F "location = /job/oss-hub-release-cd/build"
```

  - step 2와 동일한 locked probe를 pre-deploy-verify «G007 baseline·probe»로 재실행.
- 예상 결과: `nginx -t` ok, reload 성공, dual location active, unauthorized probe 판정 PASS, 상태=S1.
- 실패 전이:

```sh
sudo cp -a "<HOST_NGINX_CONF_BACKUP>" "<HOST_NGINX_CONF_DST>"
sudo nginx -t && sudo systemctl reload nginx
```

  → **S0 복귀**. C3·legacy job은 그대로 둔다.

### Step 5 — 활성화 병합·job 파라미터 제거 (owner: @GoBeromsu) → S2

- 명령/UI:

```sh
# 현재 headRefOid가 freeze와 같은지 재확인
test "$(gh api "repos/<GITHUB_OWNER>/<GITHUB_REPO>/pulls/<ACTIVATION_PR>" --jq .head.sha)" \
  = "<FROZEN_HEAD_REF_OID_ACTIVATION>"
# 불일치 시: freeze 값을 새 head로 갱신하고 MERGE_READY+PM_ACCEPT를 그 head에 재발급할 때까지 병합 금지
```

  - PR `<ACTIVATION_PR>` 최상위 댓글에 현재 head·base·base_sha 고정 `MERGE_READY ... risk=HIGH_RISK`(또는 해당 risk)와 @GoBeromsu `PM_ACCEPT head=<sha> base=<ref> base_sha=<sha>`가 **같은 head**로 존재하는지 확인([ADR-005](../decisions/ADR-005-agent-driven-review-cycle.md)). admin bypass 금지.
  - 병합:

```sh
gh pr merge "<ACTIVATION_PR>" --repo "<GITHUB_OWNER>/<GITHUB_REPO>" --merge --match-head-commit "<FROZEN_HEAD_REF_OID_ACTIVATION>"
```

  - `<JENKINS_UI>` → `oss-hub-release-cd` → **Configure**:
    - **This project is parameterized** 체크 해제(또는 `RELEASE_ACTION`·`RELEASE_TAG` 파라미터 행 삭제) → **Save**
    - **Pipeline → SCM branch**는 main/root `Jenkinsfile` 추적(별도 브랜치 pin 금지)
  - 게이트 유지 확인:

```sh
gh variable list --repo "<GITHUB_OWNER>/<GITHUB_REPO>" --jq '.[] | select(.name=="DEPLOY_TRIGGER_ENABLED") | .value'
# 반드시 false
```

- 예상 결과: main ancestry가 활성화 headRefOid를 포함하고, 운영 job이 파라미터 없는 v2 계약이며, 게이트 `false`, 상태=S2.
- 실패 전이: step 6 진입 전이면 `<JENKINS_UI>`에서 운영 job SCM Branch Specifier를 `<LEGACY_JENKINSFILE_SHA>`로 되돌리고 파라미터 `RELEASE_ACTION`·`RELEASE_TAG`를 복구해 **S1 또는 S0**으로 복귀. 게이트를 켜지 않는다.

### Step 6 — PR-7·게이트 on·배포 실증·C4·fault drill (owner: @GoBeromsu) → S3 (D7 시작)

step 6 **진입 시점부터 D7**: 이후 실패는 legacy 복원 금지. 즉시 `DEPLOY_TRIGGER_ENABLED=false` 후 v2 fix-forward만 허용한다.

1. **PR-7 마커 재발급·병합**
   - 명령/UI:

```sh
# 활성화 병합 후 새 headRefOid 읽기 (이전 freeze 무효)
NEW_PR7_HEAD="$(gh api "repos/<GITHUB_OWNER>/<GITHUB_REPO>/pulls/<PR7>" --jq .head.sha)"
printf '%s\n' "$NEW_PR7_HEAD"
```

     - 그 head·현재 base·base_sha로 exact-head `MERGE_READY` + @GoBeromsu `PM_ACCEPT`를 **재발급**한 뒤에만 병합:

```sh
gh pr merge "<PR7>" --repo "<GITHUB_OWNER>/<GITHUB_REPO>" --merge --match-head-commit "$NEW_PR7_HEAD"
```

   - 예상 결과: PR-7이 재발급 head 기준으로 병합됨.
   - 실패 전이: 게이트 off 유지, S2 고정, fix-forward PR만 허용.

2. **게이트 enable**
   - 명령/UI: GitHub → **Settings** → **Secrets and variables** → **Actions** → **Variables** → `DEPLOY_TRIGGER_ENABLED` → Value = 문자열 `true` → **Update variable**.

```sh
gh variable list --repo "<GITHUB_OWNER>/<GITHUB_REPO>" --jq '.[] | select(.name=="DEPLOY_TRIGGER_ENABLED") | .value'
# 예상: true
```

   - 예상 결과: 변수 `true`, 상태=S3.
   - 실패 전이: Value를 `false`로 되돌리고 S2 fix-forward.

3. **정상 Release 배포**
   - 명령/UI:
     - 대상 full SemVer tag의 commit이 main ancestry인지 확인 후 GitHub **Releases** → 해당 tag Release가 `draft=false`·`prerelease=false`.
     - #199에 @GoBeromsu 가 `RELEASE_ACCEPT role=PM tag=<tag> head=<40-hex-sha>` 한 줄 댓글(TECH_LEAD·OVERRIDE 금지).
     - Actions → `release.yml` 또는 `deploy.yml` `workflow_dispatch` 실행, 또는 동등한 인가 신 경로:

```sh
curl -sS -o /tmp/g007-new-trigger.body -w '%{http_code}\n' \
  -X POST "https://<PUBLIC_DEPLOY_BASE><NEW_TRIGGER_PATH>" \
  -u "<DEPLOYER_USER>:<DEPLOYER_API_TOKEN>"
# body는 비운다(파라미터 없음). HTTP는 job 수락 계약에 맞는 non-error.
```

     - health 측정은 pre-deploy-verify baseline health 명령을 사용.
   - 예상 결과: job SUCCESS, loopback·TLS `/`·`/api/v1/health` 2xx, 실행 중 tag = 대상 Release.
   - 실패 전이: 게이트 off → v2 fix-forward(D7). legacy job/C3로 운영을 되돌리지 않는다.

4. **독립 no-op 배포**
   - 명령/UI: 동일 latest Release로 위 신 경로 POST를 1회 재전달.
   - 예상 결과: Jenkins 콘솔에 성공 no-op(재빌드·재deploy 없음) 로그.
   - 실패 전이: D7(게이트 off + fix-forward).

5. **C4 N=120 격리 retention fixture (S4 필수 PASS)**
   - 명령/UI: [pre-deploy-verify](./pre-deploy-verify.md) «G007 C4»를 실행하고 그 절이 출력하는 `C4=PASS` 또는 `C4=BLOCKED`만 기록한다.
   - 예상 결과: `C4=PASS` — 공유 pruning surface가 **바이트 동일 구현**으로 존재하고, 운영 `<BACKUP_DIR>`과 분리된 121-item fixture에서 120 보존·운영 inventory digest 전후 동등(boolean true).
   - **차단 (fail-closed):** surface 부재·구현 불일치·inventory 동등 false·모호 관측이면 `C4=BLOCKED`. 이 경우:
     1. `DEPLOY_TRIGGER_ENABLED=false`로 강제
     2. 실 backup에서 retention 실행 금지
     3. **S4 선언 금지**(step 7·8 진입 금지). step 6의 다른 항목이 성공해도 C4 BLOCKED면 창을 S3 또는 게이트-off 고정으로 남긴다.
   - 실패 전이(surface 존재 시 inventory 불일치 등): D7.

6. **controlled reversible fault drill** (순서를 바꾸지 않는다)
   - 전제: 직전 정상 Release가 실행 중이며 그것이 자동 rollback의 `PREV_TAG`가 된다. C4=PASS 후에만 진행(C4 BLOCKED면 이 항목도 수행하지 않음).
   - 명령/UI — **고정 순서**:

```sh
# --- A. 검토된 가역 fault commit (migration-free · data-write-free) ---
# 예: 런타임에 즉시 smoke 실패를 유발하는 가역 변경만. Prisma migrate·DB write·volume 삭제 금지.
git fetch origin main
git checkout -b "<FAULT_BRANCH>" origin/main
# ... fault 내용 적용 (리뷰 가능한 최소 diff) ...
git commit -m "test(g007): controlled reversible fault for rollback drill"
FAULT_SHA="$(git rev-parse HEAD)"
git push -u origin "<FAULT_BRANCH>"
gh pr create --repo "<GITHUB_OWNER>/<GITHUB_REPO>" --base main --head "<FAULT_BRANCH>" \
  --title "G007 controlled fault (revert immediately)" \
  --body "migration-free data-write-free fault fixture for PREV_TAG rollback drill. Not for production retention."
# exact-head MERGE_READY + @GoBeromsu PM_ACCEPT (배포 계약 경로면 PM 전속) 후:
gh pr merge --repo "<GITHUB_OWNER>/<GITHUB_REPO>" --merge --match-head-commit "$FAULT_SHA"
# main ancestry 확인
git fetch origin main
git merge-base --is-ancestor "$FAULT_SHA" origin/main

# --- B. fault full SemVer tag + Release + PM accept ---
git checkout main && git pull --ff-only origin main
test "$(git rev-parse HEAD)" = "$FAULT_SHA"
git tag -a "<FAULT_TAG>" "$FAULT_SHA" -m "G007 fault drill <FAULT_TAG>"
git push origin "refs/tags/<FAULT_TAG>"
gh release create "<FAULT_TAG>" --repo "<GITHUB_OWNER>/<GITHUB_REPO>" \
  --title "<FAULT_TAG> G007 fault drill" --notes "controlled fault; delete before window exit" \
  --latest=false
# #199 댓글 (값 자리에 실제 tag·40-hex):
# RELEASE_ACCEPT role=PM tag=<FAULT_TAG> head=<FAULT_SHA>
# TECH_LEAD / OVERRIDE 금지

# --- C. 즉시 준비된 정상 코드 revert (fault tag는 유지, main만 정상화) ---
git revert --no-edit "$FAULT_SHA"
REVERT_SHA="$(git rev-parse HEAD)"
git push origin main
# revert PR 경로를 쓰는 경우에도 exact-head MERGE_READY+PM_ACCEPT 후 main ancestry에 포함

# --- D. fault Release 배포 트리거 (신 경로) — 자동 rollback 관측 전에 수동 정상 재배포 금지 ---
curl -sS -o /tmp/g007-fault-trigger.body -w '%{http_code}\n' \
  -X POST "https://<PUBLIC_DEPLOY_BASE><NEW_TRIGGER_PATH>" \
  -u "<DEPLOYER_USER>:<DEPLOYER_API_TOKEN>"
# Jenkins가 latest full Release로 <FAULT_TAG>를 집어 배포 시도 → 서비스 교체/smoke 실패 시
# PREV_TAG 이미지로 **정확히 한 번** 자동 rollback 하는 로그만 성공으로 센다.
# 관측 포인트: oss-hub-release-cd 해당 build Console Output에서
#   (1) fault tag 배포 시도 로그
#   (2) 실패 후 PREV_TAG=... 복구 로그 1회
#   (3) 동일 build 안에서 두 번째 임의 태그 재배포 없음
# 이 로그를 보기 전에 정상 Release를 수동/추가 트리거하지 않는다.

# --- E. fault 산출물 정리 (rollback 관측 성공 후에만) ---
gh release delete "<FAULT_TAG>" --repo "<GITHUB_OWNER>/<GITHUB_REPO>" --yes
git push origin ":refs/tags/<FAULT_TAG>"
git tag -d "<FAULT_TAG>" 2>/dev/null || true
# fault image tag 제거(실행 중·직전 성공 이미지 제외 — ADR-002 보존 규칙)
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -F "<FAULT_TAG>" || true
# 위 목록이 가리키는 fault tag 이미지만 rmi (running/PREV 성공 이미지 금지)

# --- F. 깨끗한 정상 Release 재배포 ---
# <CLEAN_TAG> = main의 정상 SHA(full SemVer), draft=false prerelease=false
# #199: RELEASE_ACCEPT role=PM tag=<CLEAN_TAG> head=<CLEAN_SHA>
curl -sS -o /tmp/g007-clean-trigger.body -w '%{http_code}\n' \
  -X POST "https://<PUBLIC_DEPLOY_BASE><NEW_TRIGGER_PATH>" \
  -u "<DEPLOYER_USER>:<DEPLOYER_API_TOKEN>"
```

   - 예상 결과: 자동 `PREV_TAG` rollback **1회**가 콘솔에서 관측되고, fault Release/tag/image가 inventory에 없으며, 최종 실행 중 tag = `<CLEAN_TAG>`. DB restore는 자동 범위 밖.
   - 실패 전이: D7. rollback 미관측 시 수동 정상 트리거로 “성공”을 대체하지 않는다. step 7 dual-only nginx 복구와 혼동하지 않는다.

### Step 7 — new-only host nginx (owner: @GoBeromsu) → S4 직전

- 전제: step 6에서 `C4=PASS` 및 fault drill 성공. 하나라도 아니면 이 step에 진입하지 않는다.
- 명령/UI:
  - pre-deploy-verify «G007 baseline·probe»의 old-path unauthorized probe만 재실행 → 판정 PASS.
  - conf 교체:

```sh
sudo cp -a "<HOST_NGINX_CONF_DST>" "<HOST_NGINX_CONF_BACKUP>"
sudo cp -a "<HOST_NGINX_CONF_SRC_NEW_ONLY>" "<HOST_NGINX_CONF_DST>"
sudo nginx -t && sudo systemctl reload nginx
# old location 부재 (grep 실패=exit 1이 성공 조건)
if sudo nginx -T 2>/dev/null | grep -F "location = /job/oss-hub-release-cd/buildWithParameters"; then
  echo "OLD_LOCATION_STILL_PRESENT"; exit 1
fi
# new location 존재
sudo nginx -T 2>/dev/null | grep -F "location = /job/oss-hub-release-cd/build"
```

  - 인가 신 경로 1회:

```sh
curl -sS -o /tmp/g007-newonly-trigger.body -w '%{http_code}\n' \
  -X POST "https://<PUBLIC_DEPLOY_BASE><NEW_TRIGGER_PATH>" \
  -u "<DEPLOYER_USER>:<DEPLOYER_API_TOKEN>"
```

- 예상 결과: old path 영-부작용, new-only active, 게이트 `true`, Jenkins v2 유지, 인가 트리거 성공(no-op 또는 정상).
- 실패 전이:

```sh
# 게이트 off
# GitHub UI Variables: DEPLOY_TRIGGER_ENABLED=false
sudo cp -a "<HOST_NGINX_CONF_SRC_DUAL>" "<HOST_NGINX_CONF_DST>"
sudo nginx -t && sudo systemctl reload nginx
```

  → dual-route nginx만 복구(S3 쪽). legacy Jenkinsfile·파라미터 job으로 내리지 않는다(D7).

### Step 8 — S4 종료 전이 (owner: @GoBeromsu)

- 명령/UI: [pre-deploy-verify](./pre-deploy-verify.md) «G007 final gate» 절차를 실행한다. 그 절이 **측정 원본**이며 `G007_FINAL=PASS` 또는 `G007_FINAL=BLOCKED` **한 줄**을 출력한다.
- 런북 전이(측정 복제 금지):
  - `G007_FINAL=PASS` → 상태=S4, 점검 창 종료.
  - `G007_FINAL=BLOCKED` → S4 선언 금지. `DEPLOY_TRIGGER_ENABLED=false`로 두고 v2 fix-forward(D7). C4 미PASS·D6 모호·fault 잔존·health 실패 모두 BLOCKED에 포함된다.
- 예상 결과: `G007_FINAL=PASS` 한 줄과 상태=S4.
- 실패 전이: `G007_FINAL=BLOCKED` 또는 출력 부재/모호 → S4 금지, 게이트 off, fix-forward.

### G007 종료 후

- C3 job은 보관하되 운영 트리거 경로에 연결하지 않는다. 제거는 별도 승인 작업이다.
- follow-up(D6 해제 등)은 이 절 밖 high-risk 작업으로 연다. C4 surface는 S4 전에 이미 PASS여야 한다.
- 팀 상태 링크·미해소 전제만 [TEAM-STATE](../handoff/TEAM-STATE.md)에 남긴다(수락 기준 복제 금지, production 수행 주장 금지).

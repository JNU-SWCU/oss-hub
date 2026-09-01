# 배포 서버 런북 — Jenkins Release 배포 파이프라인 실동작화

이 문서는 배포 서버에서 ADR-002 Jenkins Release 배포 파이프라인을 **처음 실동작**시키는 수동 절차의 단일 소유 런북이다.
파이프라인 정의는 저장소 루트 `Jenkinsfile`이 원본이며 이 런북은 명령을 복제하지 않고 스텝·검증 기준으로 서술한다.
승인 단위·트리거·롤백 계약의 원본은 [ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)다.

## 0. 절대 경계 (먼저 읽는다)

- **대상 서버는 오직 하나다.** 이 런북의 모든 접속·명령은 JNU OSS Platform 배포 EC2(리전 `ap-northeast-2`) **한 대에만** 적용한다.
- **Tailscale 망의 다른 호스트(운영 무관 서버 포함)에는 접속하지 않는다.** 이 런북에는 다른 tailnet 호스트로 붙는 절차가 없으며, 추가해서도 안 된다.
- **실제 시크릿·토큰·PAT·공인 IP·인스턴스 ID 등 접근 정보는 이 저장소에 적지 않는다.** 아래 `<...>` 자리표시자는 **운영 credentials vault**에서 실제 값을 조회해 사용한다(§8). vault 내부 경로·노트명은 이 저장소에 적지 않는다 — 이 문서는 공개 저장소에 추적된다.

## 1. 표기 규약

- `<INSTANCE_ID>` — 배포 EC2 인스턴스 ID (실제 값: 운영 credentials vault)
- `<EC2_TAILSCALE_HOST>` — 배포 EC2의 Tailscale 호스트명 (실제 값: 운영 credentials vault)
- `<GITHUB_OWNER>/<GITHUB_REPO>` — 배포 대상 저장소 (`Jenkinsfile`의 release 검증 URL 참조)
- `<JENKINS_ADMIN_USER>` — Jenkins 개인 관리자 계정 (실제 값: 운영 credentials vault)

- 각 스텝은 **명령 → 예상 출력 → 검증**의 세 요소로 적는다. 배포판·버전 차이는 스텝 의도를 유지한 채 조정한다.
- 접속 방식은 두 가지 중 하나다: AWS SSM Session Manager 또는 Tailscale SSH. 공인 SSH(22)는 열지 않는다.
- Compose ingress smoke는 `http://127.0.0.1:8081`이다. 공인 TLS smoke는 host nginx 계약(`Jenkinsfile`)을 따른다.

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
Buildx plugin도 필수다 — 배포 전과 성공 뒤 캐시 정리가 `docker buildx prune --all --force --max-used-space "$BUILD_CACHE_MAX_SPACE"`를 호출하므로 이 옵션을 지원하는 Buildx가 없으면 사전 검증 단계에서 배포가 실패한다. 이 명령은 BuildKit 캐시만 대상으로 하며 실행 중 이미지는 물론 named volume과 백업을 건드리지 않는다.
운영 서버의 확인된 기준선은 Buildx `v0.35.0`이며, 이보다 낮은 버전을 쓸 때는 `--max-used-space` 지원 여부를 먼저 확인한다.
`BUILD_CACHE_MAX_SPACE`는 `10GB`에서 `5GB`로 인하했다(2026-08-01) — 실측상 빌드 세대당 캐시 증가분이 ~2.6GB였고 직전 빌드(#31)가 이전 세대 레코드를 전혀 재사용하지 않아(last-accessed 미갱신) 오래된 세대는 히트에 기여하지 않는 죽은 용량이었다. 최신 2세대만 보존해도 충분하다는 근거로 상한을 낮췄다(`docker buildx prune --all --force --max-used-space 5GB` 실행 후 5.64GB로 수렴, 최신 2세대만 잔존, 이상 없음 확인). v0.6.124에서는 기존 non-`--all` 성공 정리가 shared/internal BuildKit 레코드를 제외해 87.57GB가 남았고 production root가 100%가 되어 디스크가 가득 찼다. 따라서 이제 같은 `--all` 명령을 이미지 빌드·배포 전 백업보다 먼저, 그리고 성공 뒤에 실행해 shared/internal 레코드도 5GB 상한으로 정리한다. 다만 빌드 직후에는 실행 중 이미지의 in-use 레이어가 정리 대상에서 보호되므로 이 상한을 일시적으로 넘길 수 있다(v0.6.1 배포 직후 `docker buildx du` 실측 11.07GB로, 인하 전 10GB 상한도 일시 초과한 사례가 있었다) — 이는 결함이 아니라 의도된 동작이다.
이전 세대가 캐시에 기여하지 못한 원인 중 하나는 세대별 용량이 아니라 근본적인 레이어 무효화였다 — 백엔드 Dockerfile의 `dependencies` 스테이지가 `apps/backend/prisma` 디렉터리 전체(스펙 파일 8개·seed 스크립트·README 등 43개 파일)를 `RUN pnpm install` 앞에 COPY해, 매 릴리즈 스펙 파일만 바뀌어도 install 레이어(~732MB)부터 전부 캐시미스가 났다(v0.6.0→v0.6.1: lockfile·package.json·Dockerfile은 byte-identical인데 prisma 스펙 파일만 변경, 빌드 #31 로그에 CACHED 4건뿐). `@prisma/client`의 postinstall(`prisma generate`)이 실제로 필요로 하는 파일은 `schema.prisma` 하나뿐이므로, COPY 대상을 그 파일로 좁혀 install 레이어가 스펙 파일 변경에 더는 반응하지 않도록 근본 원인을 고쳤다(P1). 백엔드·프런트엔드 두 Dockerfile의 `pnpm install` 스텝에는 BuildKit cache mount(`--mount=type=cache,id=pnpm-store,target=<pnpm store 경로>`)로 pnpm store를 고정해, 락파일이 실제로 바뀌어 레이어가 미스 나는 경우에도 이미 받아둔 패키지는 네트워크 재다운로드 없이 재사용하도록 보완했다(P2). 로컬 검증: 두 이미지 모두 연속 2회 빌드에서 install 레이어 CACHED 확인, `prisma` 디렉터리의 스펙 파일에 무해한 변경 후 재빌드해도 install 레이어가 CACHED로 유지됨을 확인, `schema.prisma` 자체를 바꾸면 의도대로 install 레이어가 미스 남을 확인해 invalidation이 필요할 때는 여전히 동작함을 함께 확인했다.

```sh
# Docker Engine + compose·buildx plugin (Ubuntu)
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin docker-buildx-plugin jq
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
docker buildx version     # github.com/docker/buildx v0.35.0 이상 (--max-used-space 지원 필요)
node -v                   # v24.x.x
pnpm -v                   # 11.x.x
jq --version              # jq-1.x
sudo ss -ltnp | grep 8080 # Jenkins가 127.0.0.1:8080에만 LISTEN (0.0.0.0:8080이면 안 됨)
```

- Jenkins 관리 UI는 Tailscale/SSM 터널로만 접근한다. 공인 8080 포트는 열지 않는다.

## M3. Credentials · 백업 디렉터리

```sh
# 운영 env를 Jenkins Credentials Store의 secret file로 등록 (UI 또는 JCasC)
#   credential id: oss-hub-production-env
#   ※ 실제 값은 이 저장소에 두지 않는다. 운영 credentials vault → Jenkins Credentials Store로만.

# 백업 디렉터리 (Jenkins 소유, 0700)
sudo install -d -m 700 -o jenkins -g jenkins /var/lib/oss-hub/backups
```

GitHub App 개인키는 env 문자열이 아니라 파일 시크릿으로 주입한다.
운영자가 1회만 준비하는 루트 디렉터리는 아래와 같고, 현재 서버에는 이미 반영돼 있다.

```sh
sudo install -d -o jenkins -g 1000 -m 2750 /var/lib/oss-hub/secrets
```

- 이 디렉터리는 `jenkins:1000` 소유, `2750` setgid로 유지한다.
- Jenkins Credentials Store에는 file credential 2건을 등록한다: `oss-hub-collection-app-private-key`, `oss-hub-operations-app-private-key`.
- 각 credential의 원본 파일은 운영자가 관리하는 새 generation의 `collection.pem`, `operations.pem`이다.
- 컨테이너 안에서는 `github_collection_app_private_key`와 `github_operations_app_private_key`가 각각 `/run/secrets/github_collection_app_private_key`, `/run/secrets/github_operations_app_private_key`로 마운트되고, 앱은 대응하는 `*_PRIVATE_KEY_FILE`만 읽는다.
- Jenkinsfile의 pipeline `environment`가 `GITHUB_COLLECTION_APP_PRIVATE_KEY_SOURCE`, `GITHUB_OPERATIONS_APP_PRIVATE_KEY_SOURCE`를 이미 주입하므로, `oss-hub-production-env`에는 이 두 키를 중복 기재하지 않는다.
- 수동 compose 실행 시에만 같은 값을 셸 환경이나 임시 env file에서 제공한다.
- Jenkinsfile의 `개인키 검증 및 안정 경로 설치` stage가 GitHub 실인증을 통과한 key만 새 generation에 설치하고, `실행 중 이미지 기준 no-op...` stage 바로 직전에 실행된다.

`compose.yml`은 아래 키를 `${VAR:?...}`로 요구한다. 하나라도 없으면 compose가 보간 단계에서 중단되며,
`up -d postgres`처럼 서비스 하나만 다루는 명령도 함께 실패한다.
`IMAGE_TAG`를 뺀 전부가 `oss-hub-production-env`에 있어야 한다.
`compose.yml`이 원본이며, 이 표는 그 사본이다 — 목록이 다르면 `compose.yml`을 신뢰한다.

| 키 | 용도 |
| --- | --- |
| `IMAGE_TAG` | backend 이미지 태그. **env 파일에 두지 않는다** — Jenkins가 latest full Release의 SemVer tag로 주입한다(`Jenkinsfile`). 수동으로 production compose를 돌릴 때만 셸에서 지정한다 |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | postgres 서비스 자격증명 |
| `DATABASE_URL` | postgres 서비스 DNS를 가리키는 연결 문자열 |
| `SESSION_SECRET` | 세션 서명 시크릿 |
| `TEAM_JOIN_CODE_SECRET` | 팀 참가 코드 서명 시크릿 |
| `FRONTEND_URL` | OAuth 콜백 파생 등에 쓰는 프런트엔드 base URL |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth 로그인 앱 |
| `GITHUB_COLLECTION_APP_ID` / `GITHUB_APP_ORG` | GitHub 활동 수집 App 식별자와 대상 조직 |
| `GITHUB_COLLECTION_APP_PRIVATE_KEY_SOURCE` | `compose.yml` secret `github_collection_app_private_key`의 유일한 호스트 입력 경로. 값은 `/var/lib/oss-hub/secrets/current/collection.pem`이다 |
| `GITHUB_OPERATIONS_APP_ID` | 저장소 생성·설정 변경용 GitHub App 식별자 |
| `GITHUB_OPERATIONS_APP_PRIVATE_KEY_SOURCE` | `compose.yml` secret `github_operations_app_private_key`의 유일한 호스트 입력 경로. 값은 `/var/lib/oss-hub/secrets/current/operations.pem`이다 |
| `SUBMISSION_FILE_STORAGE_MODE` | production은 exact `managed`만 허용 |
| `SUBMISSION_FILE_S3_*` | backend storage configuration. managed credential pair는 env file이 아니라 Jenkins username/password binding에서만 주입한다 |
| `MAIL_MODE` | exact `send` 또는 `dry-run`. production 발송은 `send`를 쓰며 아래 Gmail 자격증명 4종을 함께 검증한다 |
| `GMAIL_SENDER` / `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` / `GMAIL_OAUTH_REFRESH_TOKEN` | `MAIL_MODE=send`일 때 필수인 마감 알림 발신 자격증명. `dry-run`에서는 빈 값 허용 |

`SUBMISSION_FILE_S3_*`의 실제 값은 이 저장소에 두지 않는다. Managed credential pair는 production env file에도 두지 않고 Jenkins masked binding으로만 주입한다.
`compose.yml`에 env 키를 추가하거나 지우면 이 표도 같은 PR에서 갱신한다.

`GITHUB_PUBLIC_READ_TOKEN` — 외부 public 저장소 수집 전용 GitHub fine-grained PAT(REST + GraphQL 겸용)이며 위 표에는 없다. 위 `GITHUB_COLLECTION_APP_*`(Collection GitHub App installation token)는 조직 설치 범위 밖 저장소를 읽지 못하고, GitHub GraphQL v4는 OAuth App client_id:client_secret Basic Auth를 받지 않아 이 경로는 PAT 하나로 둔다. `compose.yml`이 이 키를 `${VAR:?...}`로 요구하지 않는다 — 조직 collection이 이 값 없이도 그대로 기동·동작해야 하기 때문이다. 값이 비어 있으면 외부 수집을 실제로 시도하는 시점에만 fail-closed로 실패하며, 조용히 0건으로 넘어가지 않는다. 이 PAT은 반드시 사업단 서비스 계정으로 발급한다 — 개인 계정으로 발급하면 그 사람이 조직을 떠날 때 외부 수집이 끊기고 public 저장소 조회 이력이 개인 실명에 결부되는 위험이 있다. 만료일을 설정하고 갱신 책임자를 지정해 둔다. 값은 다른 GitHub App 자격증명과 동일하게 배포 secret store에만 둔다.

#### 수집 운영 표면은 세 개다 (2026-08-19 추가)

매시 도는 스케줄러가 tick 한 번에 sweep 세 개를 돌린다. 장애를 볼 때 어느 표면이 멈췄는지를 먼저 가른다.

| sweep | 읽는 것 | 채우는 것 | 자격증명 |
| --- | --- | --- | --- |
| org | 조직 저장소 inventory + 상세(REST) | `Contribution`, fact 세 테이블 | `GITHUB_COLLECTION_APP_*` installation token |
| external | 조직 밖 등록 저장소(REST) | 같은 위 | `GITHUB_PUBLIC_READ_TOKEN` |
| **person** | 가입(ACTIVE) 유저의 한 해 활동(GraphQL) | `GithubUserActivityHistory` | `GITHUB_PUBLIC_READ_TOKEN` (같은 PAT) |

**person sweep이 세 번째 표면이다.** 공개 랭킹은 이제 이 표면만 읽으므로, org·external이 멈춰도 랭킹은 갱신된다 — 반대로 랭킹이 멈춰도 ② 프로그램 화면은 멀쩡할 수 있다. 둘을 같은 증상으로 읽지 않는다. 진단은 `scripts/diagnose-collection.sh`(read-only)이 한번에 보여 준다. 축 경계의 결정 근거는 [ADR-010](../decisions/ADR-010-contribution-tracking-context.md) 2026-08-19 개정 노트다.

#### GitHub App 개인키 파일 시크릿 회전

- generation 레이아웃은 `${SECRETS_DIR}/gen-<BUILD_NUMBER>/{collection,operations}.pem`이고, 활성 포인터는 `${SECRETS_DIR}/current` symlink다.
- Jenkins file credential 두 개가 활성 generation과 모두 같으면 새 generation과 backend 재생성을 생략한다. 하나라도 다를 때만 `gen-${BUILD_NUMBER}`를 만들며 이전 세대는 자동 정리하지 않는다. 필요 시 수동 정리하되 `current`와 실행 중 롤백 대상이 가리키는 세대는 삭제하지 않는다.
- 교체는 `ln -sfn`으로 새 generation을 가리킨 뒤 `mv -T`로 포인터를 원자적으로 바꾼다.
- 파일 모드는 `0640`만 쓴다. `0644`는 쓰지 않는다.
- 호스트에서 `sudo -u '#1000' cat /var/lib/oss-hub/secrets/current/*.pem`으로 가독을 확인하면 부모 `/var/lib/oss-hub`의 `700 jenkins:jenkins` 때문에 항상 실패한다. 이 실패는 권한 버그가 아니라 경로 traversal 차단이다.
- 가독 검증은 반드시 컨테이너 경유로 한다.
- Jenkins는 symlink 교체 결과를 확인한 뒤 backend를 `--force-recreate`하고, 컨테이너에 마운트된 두 파일이 활성 generation과 같은지 검증한다.
- 값 기반 fallback은 없으며 키 회전 실패 시 이전 generation symlink와 backend를 함께 복구한다.

### 제출 파일 storage configuration

Production storage mode는 `SUBMISSION_FILE_STORAGE_MODE=managed`로 명시한다. Backend는 `SUBMISSION_FILE_S3_ENDPOINT`, `SUBMISSION_FILE_S3_REGION`, `SUBMISSION_FILE_S3_BUCKET`, `SUBMISSION_FILE_S3_ACCESS_KEY_ID`, `SUBMISSION_FILE_S3_SECRET_ACCESS_KEY`, `SUBMISSION_FILE_S3_FORCE_PATH_STYLE`를 사용한다.

Managed mode에서는 Jenkins username/password binding이 access-key pair를 제공하고, endpoint·region·bucket·path-style은 승인된 runtime configuration에서 제공한다. 운영자는 backend에 적용된 key 이름과 configured endpoint/bucket 일치를 secret value를 출력하지 않고 확인한다. 누락·기본값 fallback·대상 불일치는 fail-closed다.

- 검증:

```sh
stat -c '%a %U %G %n' /var/lib/oss-hub/backups
# 700 jenkins jenkins /var/lib/oss-hub/backups
```

- Credentials Store에 `oss-hub-production-env`가 보이고, secret file 값이 로그·workspace에 출력되지 않는지 확인한다.

## M4. Parameterless Jenkins job

`Jenkinsfile`은 입력 파라미터 없이 latest full Release를 조회하고 `oss-hub-production` agent에서 배포한다.

- Pipeline job은 main SCM의 root `Jenkinsfile` 하나만 읽는다.
- Jenkins parameter definitions는 두지 않는다.
- Docker 권한을 가진 executor에 `oss-hub-production` label을 부여하고, 이 job과 승인된 운영자 외 작업을 배치하지 않는다. `disableConcurrentBuilds()`는 `Jenkinsfile`이 강제한다.
- 자동·수동 재실행 모두 exact `POST /job/oss-hub-release-cd/build`을 사용한다. 계약 원본은 [ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)다.
- 검증: job 설정의 script path가 `Jenkinsfile`, branch가 `main`, parameter definition 수가 0인지 확인한다.

## M5. GitHub API 호출 준비

`Jenkinsfile`의 release 검증은 GitHub API `releases/latest`를 호출한다. 공개 저장소라 미인증(60/hr)으로도 동작한다.

- read-only PAT를 Jenkins Credentials Store에 **준비·문서화**한다(레이트리밋/향후 private 대비).
- **`Jenkinsfile`에 인증 헤더를 넣는 코드 변경은 이 런북 범위가 아니다.** 현재 파이프라인은 미인증 curl을 사용한다.
- PAT 실제 값은 저장소·PR·로그에 남기지 않는다. 운영 credentials vault → Jenkins Credentials Store로만.

## M6. 배포 전 단계 검증 (로컬 → EC2 드라이런)

첫 Release e2e 전에 [pre-deploy-verify](./pre-deploy-verify.md)의 ① 로컬 랩탑 검증과 ② 배포 EC2 서버-로컬 드라이런을 순서대로 통과시킨다. 앞 단계가 통과해야 다음으로 넘어간다.

- 검증: ①은 `compose.yml + compose.local.yml`의 local frontend·MinIO substitute를 검증한다. ②는 배포 서버의 현재 backend image metadata와 loopback root 404, `/api/v1/health` 200, 제출 파일 인증 경계를 읽기 전용으로 확인한다. 업로드 기대값의 원본은 `Jenkinsfile` rollout smoke다.

## M7. 첫 Release 수동 트리거 e2e

1. main에 있는 exact commit으로 full GitHub Release(예: `v0.1.0`)를 발행한다(`draft=false`, `prerelease=false`, tag SHA가 main ancestry). 이 발행이 배포 인가이며 별도 승인 댓글은 남기지 않는다([ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)).
2. M4 job을 파라미터 없이 수동 트리거한다.
3. 파이프라인이 순서대로 수행되는지 콘솔 로그로 확인한다: exact SHA detached checkout → production env·rollback preflight → PostgreSQL·managed object backup → backend image 서버 로컬 build → `prisma migrate deploy` → `up -d --no-build --wait` → loopback Compose ingress smoke → public TLS smoke. Lint·typecheck·test는 merge 전 required CI가 소유하고 Jenkins에서 반복하지 않는다.

- 예상 출력: loopback `/`는 404, loopback·TLS `/api/v1/health`는 200, public TLS `/`는 canonical 308이며 제출 파일 경로가 [pre-deploy-verify](./pre-deploy-verify.md) ②의 기대값과 같다. Backend image의 OCI version은 Release tag, revision은 exact 40-hex SHA다.
- 검증:

```sh
docker compose --env-file "$OSS_HUB_ENV_FILE" ps
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/)" = 404 && echo "root closed"
curl -fsS http://127.0.0.1:8081/api/v1/health > /dev/null && echo "health OK"
# 업로드 경로 5종은 pre-deploy-verify ②의 명령을 그대로 쓴다 — 기대값을 여기 복사하면 갈라진다.
# 공인 TLS smoke는 host nginx·인증서 계약이 준비된 뒤에 Jenkinsfile과 동일 경로로 확인한다.
```

- `/api/v1/health` 200은 PostgreSQL 연결까지 확인한 결과다. DB에 닿지 못하면 503이므로 이 스텝이 DB 가용성 확인을 겸한다.

- **no-op 재확인**: 파라미터 없이 job을 다시 실행하면 실행 중 tag·revision과 latest Release가 같음을 증명하고 성공 no-op 처리되는지 확인한다.
- 실패 시: `PREV_TAG`가 없는 첫 배포는 자동 rollback 대상이 없다. 로그·백업을 보존하고 수동 복구한다. `down -v`는 사용하지 않는다.

## M8. Managed R2 production contract

현재 production 제출 파일 저장소는 private managed R2다(2026-09-02 cutover·cleanup 완료, receipt는 [Issue #1113](https://github.com/JNU-SWCU/oss-hub/issues/1113)). MinIO service·volume·credential, migration/hold branch와 AWS frontend runtime은 제거됐다.

1. `SUBMISSION_FILE_STORAGE_MODE`는 exact `managed`여야 한다.
2. Endpoint는 승인된 Cloudflare R2 HTTPS endpoint, region은 `auto`, path-style은 `true`여야 한다.
3. Access-key pair는 Jenkins masked binding으로만 주입하며 production env file, console, workspace 또는 명령 인자에 기록하지 않는다.
4. Candidate와 실행 중 backend의 non-secret storage tuple이 다르면 backup·build·rollout 전에 fail-closed한다.
5. Release는 configured endpoint/bucket을 사용하는 SDK object backup과 manifest SHA-256, PostgreSQL backup을 만든 뒤 backend image를 교체한다.
6. Rollback은 captured previous backend image ID·version·revision이 exact match할 때만 허용한다. Object storage mode를 되돌리는 rollback은 없다.
7. Production Compose root와 비API path는 404이고 `/api/`와 exact OAuth callback만 backend로 전달한다. Local frontend와 MinIO substitute는 `compose.local.yml`에서만 존재한다.

과거 G0–G9 migration 절차와 수용 deviation은 [Cloudflare R2 readiness](../handoff/cloudflare-r2-readiness.md)와 Issue #1113 receipt가 기록 원본이다. 완료된 migration 명령을 production runbook 절차로 다시 실행하지 않는다.

### M8-E. checkpoint B public ingress 전환

checkpoint B에서는 host nginx의 public catch-all이 Compose frontend를 proxy하지 않는다. GET과 HEAD는 canonical Vercel origin으로 308 redirect하고, 그 밖의 method는 빈 body의 404로 끝낸다. `/api/`, OAuth, deploy trigger와 loopback health/smoke 경로는 변경하지 않는다.

sudo 권한이 있는 운영자가 이전 설정 백업을 보존한 상태에서 설정을 교체한 뒤, 참석 하에 아래 순서로 적용한다. `nginx -t`가 성공한 경우에만 reload한다.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

문제가 있으면 직전 `oss-hub.conf` 백업을 복원하고 같은 문법 검사와 reload를 수행한다.

```bash
sudo cp /etc/nginx/conf.d/oss-hub.conf.bak-<timestamp> /etc/nginx/conf.d/oss-hub.conf
sudo nginx -t && sudo systemctl reload nginx
```

## M9. 호스트 nginx 설정 반영

호스트 nginx는 Compose가 아니라 시스템 서비스이고 Jenkins 계정에는 sudo가 없다.
따라서 `deploy/host-nginx/oss-hub.conf`를 바꾼 PR을 병합해도 서버에는 자동으로 반영되지 않는다.
반영하지 않은 채 배포하면 `호스트 nginx 드리프트 사전 검증` stage가 fail-closed로 배포를 세운다([#562](https://github.com/JNU-SWCU/oss-hub/issues/562)).

sudo 권한이 있는 계정으로 아래를 순서대로 수행한다.

```bash
# 1. 저장소 원본을 서버로 옮긴다(로컬에서 실행)
scp deploy/host-nginx/oss-hub.conf <host>:/tmp/oss-hub-new.conf

# 2. 백업 → 교체 → 문법 검사 → reload (서버에서 실행)
sudo cp /etc/nginx/conf.d/oss-hub.conf "/etc/nginx/conf.d/oss-hub.conf.bak-$(date +%Y%m%d-%H%M%S)"
sudo cp /tmp/oss-hub-new.conf /etc/nginx/conf.d/oss-hub.conf && rm -f /tmp/oss-hub-new.conf
sudo nginx -t
sudo systemctl reload nginx
```

`nginx -t`가 실패하면 reload하지 말고 백업본을 되돌린다.

반영 뒤 드리프트가 사라졌는지 배포 계정 권한으로 확인한다.

```bash
sudo -u jenkins bash scripts/check-host-nginx-drift.sh
```

교체 전 백업본은 `/etc/nginx/conf.d/oss-hub.conf.bak-<timestamp>`로 남으므로 되돌릴 때 그대로 복사한다.
활성 설정 파일은 `0644`라 배포 계정이 읽을 수 있고, 이 검사는 새 권한을 요구하지 않는다.

## M10. 팀 모델 통일 마이그레이션 전 OutboxEvent drain

D5 마이그레이션(`Application.teamId` non-nullable)을 적용하기 전에, 미처리 repository provision outbox가 0건인지 확인한다.
스키마 변경 창에서 프로비저닝 큐가 진행 중이면 큐 상태가 불명확해지므로 선행 drain을 강제한다.
워커는 payload `teamId`가 null인 레거시 이벤트도 허용하지만(`repository-provision.worker.ts`), 그것에 기대지 않는다.

```sh
# backend 컨테이너 또는 DATABASE_URL이 설정된 셸에서 실행
docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT status, count(*) AS n
   FROM \"OutboxEvent\"
   WHERE type = 'REPOSITORY_PROVISION_REQUESTED'
     AND status IN ('PENDING', 'PROCESSING')
   GROUP BY status
   ORDER BY status;"
```

- 예상 출력: 행이 없거나 각 `n`이 0.
- 검증: `PENDING`/`PROCESSING` 합이 0일 때만 D5 마이그레이션을 진행한다(M11).
- 0이 아니면 repository provision worker가 drain할 때까지 기다린 뒤 같은 질의를 다시 실행한다.
- drain이 멈추면 worker 로그의 `repositories.provision.failed`와 `OutboxEvent`/`RepositoryProvisionJob` 상태를 먼저 보고, 마이그레이션을 강행하지 않는다.

### M11. 팀 모델 통일(D5) 마이그레이션 — 단일 패스

`Application.teamId`를 NOT NULL로 만드는 릴리스는 **마이그레이션 하나로 끝난다.** `prisma migrate deploy` 한 번이면 되고 별도 절차가 없다.

예전 계획은 구조 변경 → Node 백필 → `SET NOT NULL` 3단이었다. `Team.joinCodeDigest`가 `HMAC-SHA256(joinCode, TEAM_JOIN_CODE_SECRET)`이라 SQL에서 만들 수 없어, 기존 `teamId IS NULL` 신청에 팀을 붙이려면 애플리케이션 코드가 필요했기 때문이다. **이 릴리스는 스키마를 새로 만들고 배포하므로 살릴 레거시 행이 없다.** 백필 스크립트는 제거했다.

마이그레이션에는 fail-closed 가드가 남아 있다. `teamId IS NULL`인 행이 하나라도 있으면 다음과 같이 멈춘다.

```
Application.teamId NOT NULL blocked: N legacy application row(s) have teamId NULL
HINT: This release assumes a schema created from scratch. Recreate the database ... and redeploy.
```

이 예외를 보면 **데이터가 있는 DB에 잘못 적용한 것**이다. 조용히 깨진 게 아니라 아무것도 바꾸지 않고 멈춘 상태이므로, 데이터베이스를 새로 만들고 다시 배포한다.

```bash
# 실패한 마이그레이션 기록을 되돌린다 — 안 하면 이후 배포가 거부된다.
docker run --rm --network "${COMPOSE_PROJECT_NAME}_default" \
  --env-file "$OSS_HUB_ENV_FILE" "oss-hub-backend:${IMAGE_TAG}" \
  npx prisma migrate resolve --rolled-back 20260804200000_application_require_team
```

마이그레이션 전체가 하나의 `BEGIN`/`COMMIT` 안이라 부분 적용 상태가 남지 않는다.

M10의 outbox drain 확인은 그대로 유효하다 — 백필 이전 이벤트의 `teamId`가 null이라는 이유는 사라졌지만, 스키마 변경 전에 진행 중인 프로비저닝을 비워 두는 것은 여전히 안전한 습관이다.

## 8. 운영 credentials vault에 기록할 접근 정보 체크리스트 (aside 위임)

아래 항목의 **실제 값**은 이 저장소가 아니라 **운영 credentials vault**가 원본이다(2026-08-19 정정 — 이전에 이 문서가 다른 곳을 가리켜 실행자가 엉뚱한 곳을 뒤졌다. AGENTS.md §2 — 한 사실은 한 원본). vault 이름·내부 경로·노트명은 공개 저장소인 여기 적지 않으며, 위치를 모르면 운영 담당자에게 묻는다. 기록 작업은 craft-skills aside에 위임한다(이 저장소·PR·로그에는 항목명만 남기고 값은 남기지 않는다).

- [ ] 배포 EC2 인스턴스 ID / Tailscale 호스트명 / 접속 방법(SSM·Tailscale)
- [ ] Jenkins 개인 관리자 계정(공용 계정 공유 금지)
- [ ] `oss-hub-production-env` secret file의 항목 목록(값 제외)
- [ ] GitHub read-only PAT의 소재·권한 범위(값 제외)
- [ ] 백업 디렉터리 경로와 소유·권한 정책
- [ ] host nginx·공인 TLS·Jenkins 원격 트리거 경로 설정 소재(값 제외)

## 9. 오늘 범위 밖 (follow-up / 별도 PR)

- **자동 트리거 live 연결 검증** (GitHub Actions `deploy.yml` → Jenkins parameterless `/build` e2e) — 수동 M7과 별도 확인.
- **`Jenkinsfile` GitHub API 인증(PAT)** 적용(코드 변경) — follow-up.
- **host nginx TLS/IP 인증서 live 운영 점검**.

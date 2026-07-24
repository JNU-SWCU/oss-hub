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
#   내용: 운영 POSTGRES_*, DATABASE_URL, SESSION_SECRET, FRONTEND_URL, GITHUB_OAUTH_* 등
#   ※ 실제 값은 이 저장소에 두지 않는다. Notion credentials → Jenkins Credentials Store로만.

# 상태/백업 디렉터리 (Jenkins 소유, 0700)
sudo install -d -m 700 -o jenkins -g jenkins /var/lib/oss-hub/deploy-state
sudo install -d -m 700 -o jenkins -g jenkins /var/lib/oss-hub/backups
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
- **webhook 자동 트리거는 오늘 범위가 아니다(§7 follow-up).** 오늘은 파라미터를 손으로 입력해 job을 수동 트리거한다.

- 검증: 파라미터 없이 job을 1회 빌드하면 `RUN_MODE=main`으로 lint/typecheck/test/build 검증만 수행하고 production을 건드리지 않는다(콘솔 로그로 확인).

## M5. GitHub read-only PAT (준비·문서화만)

`Jenkinsfile`의 release 검증은 GitHub API `repos/<GITHUB_OWNER>/<GITHUB_REPO>/releases/latest`를 호출한다. 공개 저장소라 미인증(60/hr)으로도 동작한다.

- 오늘 범위: read-only PAT를 Jenkins Credentials Store에 **준비·문서화**한다(레이트리밋/향후 private 대비).
- **`Jenkinsfile`에 인증 헤더를 넣는 코드 변경은 오늘 하지 않는다(§7 follow-up).**
- PAT 실제 값은 저장소·PR·로그에 남기지 않는다. Notion credentials → Jenkins Credentials Store로만.

## M6. 배포 전 단계 검증 (로컬 → EC2 드라이런)

첫 Release e2e 전에 [pre-deploy-verify](./pre-deploy-verify.md)의 ① 로컬 랩탑 검증과 ② 배포 EC2 서버-로컬 드라이런을 순서대로 통과시킨다. 앞 단계가 통과해야 다음으로 넘어간다.

- 검증: ②에서 배포 EC2 서버-로컬로 이미지 빌드 + `docker compose up` + `/`·`/api/v1/health` smoke가 1회 성공.

## M7. 첫 Release v0.1.0 수동 트리거 e2e

1. main에 있는 exact commit으로 full GitHub Release `v0.1.0`을 발행한다(`draft=false`, `prerelease=false`, tag SHA가 main ancestry).
2. M4 job을 **수동 트리거**하며 파라미터를 입력한다: `RELEASE_ACTION=published`, `RELEASE_TAG=v0.1.0`.
3. 파이프라인이 순서대로 수행되는지 콘솔 로그로 확인한다: exact SHA detached checkout → build/test → PostgreSQL 기동 + `pg_dump` 백업 → front/back 이미지 서버 로컬 빌드 → `prisma migrate deploy` → `up -d --no-build --wait` → `/`·`/api/v1/health` smoke.

- 예상 출력: smoke 두 요청이 HTTP 200. `current-release` 상태 파일에 `v0.1.0 <40-hex-sha>` 기록.
- 검증:

```sh
sudo cat /var/lib/oss-hub/deploy-state/current-release   # v0.1.0 <sha>
curl -fsS http://127.0.0.1/            > /dev/null && echo "root OK"
curl -fsS http://127.0.0.1/api/v1/health > /dev/null && echo "health OK"
```

- **no-op 재확인**: 동일 `v0.1.0`을 다시 전달(job 재트리거)하면 상태 파일 비교로 성공 no-op 처리되어 재배포가 일어나지 않는지 확인한다.
- 실패 시: `PREV_TAG`가 없는 첫 배포는 자동 rollback 대상이 없다. [init-operations](../exec-plan/active/init-operations.md) 복구 절차대로 로그·백업을 보존하고 수동 복구한다. `down -v`는 사용하지 않는다.

## 8. Notion에 기록할 접근 정보 체크리스트 (aside 위임)

아래 항목의 **실제 값**은 이 저장소가 아니라 **Notion credentials 페이지**가 원본이다. Notion 기록 작업은 craft-skills aside에 위임한다(이 저장소·PR·로그에는 항목명만 남기고 값은 남기지 않는다).

- [ ] 배포 EC2 인스턴스 ID / Tailscale 호스트명 / 접속 방법(SSM·Tailscale)
- [ ] Jenkins 개인 관리자 계정(공용 계정 공유 금지)
- [ ] `oss-hub-production-env` secret file의 항목 목록(값 제외)
- [ ] GitHub read-only PAT의 소재·권한 범위(값 제외)
- [ ] 상태/백업 디렉터리 경로와 소유·권한 정책

## 9. 오늘 범위 밖 (follow-up / 별도 PR)

- **webhook 자동화** (GitHub Release webhook → Generic Webhook Trigger로 job 자동 트리거) — follow-up.
- **`Jenkinsfile` GitHub API 인증(PAT)** 적용(코드 변경) — follow-up.
- **nginx TLS(443)/도메인/인증서** — follow-up.
- **ADR-002 'HMAC 검증' 문구 개정** — 별도 PR.

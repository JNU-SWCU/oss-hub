# 초기 운영 절차

이 문서는 초기 배포 전후 수동 운영 절차의 단일 소유 문서다. 비밀값은 저장소에 기록하지 않으며 `.env.example`만 추적한다.

## M1. branch protection 설정

시점: PR2가 병합된 직후에 main 브랜치 보호 규칙을 설정한다.

1. GitHub 저장소의 Settings > Branches에서 main 대상 branch protection rule을 만든다.
2. Pull request를 통한 병합을 필수로 하되 일반 PR의 사람 승인 리뷰는 required로 두지 않는다.
3. required status checks에 정확히 `ci`와 `public-safe`를 추가하고, 최신 커밋이 두 check를 통과하도록 요구한다.
4. 병합 게이트는 required status check(`ci`·`public-safe`) 통과와 GitHub mergeable 상태로 고정한다 — 코멘트 기반 `MERGE_READY`·high-risk 이중 accept 수동 대조와 `merge-policy` 판정기는 second source of truth 위험 때문에 폐지했고(ADR-005 2026-08-04 변경), required check에 추가할 계획도 없다.
5. 설정 기록을 완료 증거로 보관한다.

## M2. Jenkins Release 트리거 설정

### 트리거와 승인 경계

1. Jenkins 관리 UI는 서버의 `127.0.0.1:8080`에만 bind하고 Tailscale SSH tunnel로 접근한다. 공인 8080 포트는 열지 않는다.
2. main push 품질 검증은 GitHub Actions `ci`가 담당한다. Jenkins는 production Release 배포만 담당한다.
3. production은 공개 GitHub Release를 배포 후보로 사용한다. `draft=false`·`prerelease=false`인 `published` 이벤트를 GitHub Actions가 별도 feature flag 없이 Jenkins 내장 원격 빌드 트리거로 전달한다.
4. GitHub Actions는 HTTPS `JENKINS_DEPLOY_URL`만 허용하고 전용 `oss-hub-deployer` API token을 Basic Authorization header로 사용해 parameterless POST를 보낸다. host nginx는 정확한 `/job/oss-hub-release-cd/build` POST만 localhost Jenkins로 프록시하며 Jenkins UI는 공개하지 않는다.
5. Jenkins는 현재 latest full Release와 일치하는 `vMAJOR.MINOR.PATCH` tag 및 main ancestry를 검증한다. 이 세 검사를 통과한 exact SHA만 checkout하며 별도 승인 marker는 요구하지 않는다 — 배포 인가는 Release 발행 자체이고 인가 주체 통제는 GitHub의 Release 발행 권한이 담당한다([ADR-002](../../decisions/ADR-002-CI-CD-파이프라인.md)).
6. Docker 권한을 가진 executor에는 `oss-hub-production` 전용 label을 부여하고 이 job과 승인된 운영자 외 작업을 배치하지 않는다. pipeline에 `disableConcurrentBuilds()`를 적용하고 `COMPOSE_PROJECT_NAME`을 고정한다.
7. 실행 중 frontend·backend의 version·revision label이 latest Release tag·SHA와 같을 때만 성공 no-op 처리한다. partial·stopped·label 불일치는 fail-closed다.
8. Jenkins API token과 운영 환경 파일은 각 시스템의 Credentials Store에서만 관리한다. Release payload, 저장소, Actions·Jenkins 로그에 실제 값을 출력하지 않는다.
9. Release 발행 권한은 배포 권한과 같다. 협업자에게 Release 발행 권한을 주는 것은 production 배포 권한을 주는 것이므로 권한 목록을 배포 통제로 관리한다.
10. Jenkins 관리자는 공용 계정을 공유하지 않고 개인 계정으로 식별한다. 운영 인계 시 새 담당자의 개인 관리자 계정으로 접속을 확인한 뒤 이전 담당자 권한을 회수하며, 기존 비밀번호를 전달하지 않는다.

### 배포 순서

1. latest full Release의 SemVer tag를 main ancestry에 포함된 exact commit SHA로 해석한 뒤 detached checkout한다.
2. 실행 중 frontend·backend가 모두 없으면 greenfield로 진행한다. 둘 다 실행 중이면 OCI version·revision을 비교해 동일 Release만 성공 no-op 처리하고, partial·stopped·불일치 상태는 배포를 중단한다.
3. 재사용 workspace에서도 backend Prisma client를 명시 생성한 뒤 lint, typecheck, test, 앱 build를 통과시킨다.
4. 현재 실행 중인 front/back의 동일 SemVer tag와 immutable Image ID를 rollback 기준으로 캡처한다.
5. PostgreSQL을 healthy 상태로 기동하고 migration 전에 `pg_dump` backup을 접근 제한 경로에 보존한다.
6. Release tag로 front와 back 이미지를 서버 로컬에서 각각 한 번만 빌드하고 exact SHA를 OCI revision label로 기록한다. 레지스트리에 push하거나 pull하지 않는다.
7. 6에서 빌드한 backend 이미지로 `prisma migrate deploy`를 실행한다.
8. `up -d --no-build --wait --wait-timeout <n>`로 nginx, front, back, postgres를 동일 Release tag로 기동하고 loopback Compose ingress와 공인 IP TLS에서 `/`·`/api/v1/health` smoke를 모두 수행한다. loopback Compose ingress에서는 제출 파일 업로드 경로가 403인지도 함께 단언한다 — 실행 중 nginx 설정에 fail-closed 차단이 실제로 있는지는 ingress를 호출해야만 증명된다. `/api/v1/health`는 PostgreSQL 연결을 확인하므로 DB 미가용은 503으로 드러난다.
9. 모두 성공한 뒤에만 실행 중·직전 이미지를 보존하고 backup 최근 N=120을 정리한다.
10. 서비스 교체 또는 smoke 실패 시 로그를 보존하고 캡처한 직전 Image ID가 유효하면 rollback을 한 번 수행한다. greenfield이거나 rollback smoke도 실패하면 자동 재귀 시도 없이 수동 복구로 전환한다.

Compose 종료·재기동 절차에서 `down -v`를 실행하지 않는다. PostgreSQL 데이터는 named volume `pgdata`에 보존한다.

### 구현 완료 — parameterless Release 배포 (2026-07-29)

- 운영 job은 main의 root `Jenkinsfile` 하나를 읽고 파라미터 없이 latest Release를 배포한다. v0.3.1 실제 배포와 독립 no-op 재실행이 성공했다. 자동 트리거 계약과 배포 인가 경계의 원본은 [ADR-002](../../decisions/ADR-002-CI-CD-파이프라인.md)다.
- GitHub read-only PAT는 `releases/latest` 조회 API용으로 Jenkins Credentials Store에 **준비·문서화만** 한다. `Jenkinsfile`에 인증을 적용하는 코드 변경은 follow-up이다.
- 서버 접속·설치·job·첫 Release e2e의 명령 수준 절차는 [server-runbook](../../deploy/server-runbook.md), 배포 전 로컬→EC2 단계 검증은 [pre-deploy-verify](../../deploy/pre-deploy-verify.md)를 따른다.
- 서버 접근 정보·credentials 값은 이 저장소가 아니라 **Notion credentials 페이지**가 원본이며, Notion 기록은 craft-skills aside에 위임한다. 저장소에는 항목명과 `.env.example` 변수명만 둔다.
- smoke 기준은 Compose loopback `http://127.0.0.1:8081/`·`/api/v1/health` 200과 제출 파일 업로드 경로 403, 그리고 host nginx 공인 IP TLS smoke다(위 M2·M4, `Jenkinsfile`).

## M3. 배포 서버와 개발 환경변수

### 배포 서버

1. 운영 환경 파일을 Jenkins Credentials Store의 secret file `oss-hub-production-env`로 등록한다.
2. 운영 key 목록과 값 형식의 원본은 [server-runbook](../../deploy/server-runbook.md)의 운영 환경 파일 표를 따른다. 메일은 `MAIL_MODE=send`와 production `GMAIL_SENDER`·`GMAIL_OAUTH_*` 3종을 함께 주입하며, `NODE_ENV`는 발송 여부의 권위가 아니다. `DATABASE_URL`은 `postgres` 서비스 DNS를 가리키고 migration과 runtime이 동일한 URL을 사용한다. `AUTH_INITIAL_ROLES`는 초기 역할을 부여할 계정이 있을 때만 `githubId:ROLE` 형식으로 설정한다.
3. 저장소에는 `.env.example`만 두고 실제 운영 파일은 커밋하거나 Jenkins 로그에 출력하지 않는다.
4. Jenkins가 Compose 및 migration 단계에서만 임시 file credential을 주입하고 종료 후 workspace에 복사본을 남기지 않는지 확인한다.
5. `/var/lib/oss-hub/backups`는 Jenkins 소유 `0700` 디렉터리로 만들고 symlink·group write를 허용하지 않는다. 생성되는 backup 파일은 `0600`인지 확인한다.

### 개발 환경

1. 개발자는 [local-dev](../../rules/local-dev.md)의 `pnpm local:up`으로 `compose.yml`과 `compose.local.yml` 두 파일만 적용하는 정규 로컬 실행을 시작한다.
2. 필요한 환경 변수와 `AUTH_INITIAL_ROLES`는 개발 `.env`에만 설정한다.
3. 개발 `.env`를 커밋하지 않는다.
4. backend와 frontend를 포함한 개발 서비스의 상태는 Docker Compose에서 확인한다.

## M4. 공인 IP TLS 종단

1. host nginx가 공인 `80/443`을 소유하고 `https://54.116.116.174`의 TLS를 종료한다. Compose nginx는 `127.0.0.1:8081`에만 bind한다.
2. Certbot 5.4 이상으로 `--preferred-profile shortlived`, `--webroot`, `--ip-address 54.116.116.174`를 사용한다. IP 인증서는 약 6일 유효하므로 일반 90일 인증서처럼 취급하지 않는다.
3. HTTP-01 webroot는 `/var/www/certbot`이며 host nginx는 `/.well-known/acme-challenge/`만 HTTP로 제공하고 나머지 HTTP 요청은 HTTPS로 redirect한다.
4. 발급된 인증서는 `/etc/letsencrypt/live/54.116.116.174/`에서 읽고, 성공한 갱신 뒤 host nginx를 reload하는 deploy hook과 하루 두 번 이상의 자동 갱신 timer를 유지한다.
5. `deploy/host-nginx/oss-hub.conf`를 `/etc/nginx/conf.d/oss-hub.conf`에 설치하고 `nginx -t`를 통과한 뒤 reload한다. 공인 Jenkins 표면은 rate limit과 8 KiB body 제한이 적용된 exact `/job/oss-hub-release-cd/build` POST 한 경로뿐이다.
6. production GitHub OAuth App의 homepage와 callback은 각각 `https://54.116.116.174`와 `https://54.116.116.174/api/v1/auth/github/callback`으로 고정한다.
7. 인증서 만료 시각, 자동 갱신 timer, staging renewal, 실제 HTTPS `/`·`/api/v1/health` 결과를 완료 증거로 보존한다.

참고: [Let's Encrypt IP certificate 안내](https://letsencrypt.org/2025/07/01/issuing-our-first-ip-address-certificate), [Certbot IP certificate 안내](https://www.eff.org/deeplinks/2026/03/certbot-and-lets-encrypt-now-support-ip-address-certificates)

## 복구 절차

### PREV_TAG가 있는 서비스 교체 또는 smoke 실패

1. 실패한 `up` 또는 smoke check, `docker compose ps`, Compose 로그와 Jenkins 콘솔 로그를 보존한다.
2. Compose 서비스의 이미지 태그를 `PREV_TAG`로 되돌린다.
3. `up -d --no-build --wait`로 이전 이미지를 기동한다.
4. `/`·`/api/v1/health`와 제출 파일 업로드 경로 403 smoke check를 다시 수행한다. rollback으로 되돌린 이미지도 같은 3종을 통과해야 복구로 인정한다.
5. 복구 결과, 실패 SHA, `PREV_TAG`, 로그 위치를 운영 기록에 남긴다.

migration은 자동으로 되돌리지 않는다. DB 복구가 필요하면 해당 Release 직전 backup과 로그를 확인한 뒤 운영 책임자의 승인으로 수동 restore한다.

### greenfield 서비스 교체 또는 smoke 실패

`PREV_TAG`가 없는 첫 배포는 자동 rollback 대상이 없다. Jenkins 콘솔 로그와 Compose 서비스 로그를 보존하고, 배포 서버의 Jenkins build 기록 및 Compose 프로젝트 로그 위치를 운영 기록에 남긴다. 원인을 수정한 뒤 같은 SHA 규칙으로 수동 재배포한다. 데이터 볼륨 삭제를 위한 `down -v`는 사용하지 않는다.

## 완료 증거

- main branch protection의 required status check가 정확히 `ci`·`public-safe`인 설정 기록
- main 검증 job과 HTTPS GitHub Actions→Jenkins Release 트리거의 분리, latest full Release·full SemVer tag·main ancestry 검증 기록
- Jenkins pipeline의 전용 `oss-hub-production` executor, `disableConcurrentBuilds()`, 고정 `COMPOSE_PROJECT_NAME`, exact tag SHA·main ancestry 검증 기록
- 동일·하위 Release 성공 no-op 기록
- 배포 로그의 exact `IMAGE_TAG`, migration 전 backup, 이미지 1회 build, migration, `up -d --no-build --wait` 실행 기록
- loopback Compose ingress와 공인 IP TLS의 `/`·`/api/v1/health` smoke 결과, loopback ingress 제출 파일 업로드 403 단언 결과(rollout·rollback 양쪽)
- `/api/v1/health`가 PostgreSQL 미가용에서 503을 반환하는지 확인한 기록
- Let's Encrypt IP 인증서의 SAN·만료 시각과 Certbot 자동 갱신 timer·staging renewal 결과
- `PREV_TAG` rollback 또는 greenfield 수동 복구 절차를 확인한 기록
- 운영 환경 파일은 Jenkins secret file로 비공개 관리되고 저장소에는 `.env.example`만 존재한다는 확인 기록

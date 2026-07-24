# 초기 운영 절차

이 문서는 초기 배포 전후 수동 운영 절차의 단일 소유 문서다. 비밀값은 저장소에 기록하지 않으며 `.env.example`만 추적한다.

## M1. branch protection 설정

시점: PR2가 병합된 직후에 main 브랜치 보호 규칙을 설정한다.

1. GitHub 저장소의 Settings > Branches에서 main 대상 branch protection rule을 만든다.
2. Pull request를 통한 병합을 필수로 하고 최소 1개의 승인 리뷰를 요구한다.
3. required status checks에 정확히 `ci`를 추가하고, 최신 커밋이 해당 check를 통과하도록 요구한다.
4. PR을 열어 `ci`가 모든 PR에서 보고되는지 확인한다. 변경 경로가 CI 대상이 아니어도 내부 paths gate가 성공 결과를 보고해야 한다.
5. 설정 화면과 통과한 PR의 `ci` 상태를 완료 증거로 보관한다.

## M2. Jenkins webhook 설정

### 트리거와 승인 경계

1. Jenkins 관리 UI는 서버의 `127.0.0.1:8080`에만 bind하고 Tailscale SSH tunnel로 접근한다. 공인 8080 포트는 열지 않는다.
2. main push는 Jenkins의 lint, typecheck, test, 앱 build 검증만 시작한다. production Compose를 변경하지 않는다.
3. production은 GitHub Release 발행을 사람 승인 지점으로 사용한다. HMAC이 검증된 release webhook의 `created`·`published` action만 허용하고, job 입력에는 action과 tag만 전달한다.
4. Jenkins는 `draft=false`, `prerelease=false`, 현재 latest full Release와 일치하는 `vMAJOR.MINOR.PATCH` tag만 처리한다. tag commit이 main ancestry에 포함되지 않으면 배포를 거절한다.
5. Docker 권한을 가진 executor에는 `oss-hub-production` 전용 label을 부여하고 이 job과 승인된 운영자 외 작업을 배치하지 않는다. pipeline에 `disableConcurrentBuilds()`를 적용하고 `COMPOSE_PROJECT_NAME`을 고정한다.
6. 이미 성공한 Release와 같거나 낮은 버전은 영속 상태 파일을 기준으로 성공 no-op 처리한다.
7. webhook secret과 운영 환경 파일은 Jenkins Credentials Store에서만 관리한다. webhook payload, 저장소, Jenkins 로그에 실제 값을 출력하지 않는다.
8. Jenkins 관리자는 공용 계정을 공유하지 않고 개인 계정으로 식별한다. 운영 인계 시 새 담당자의 개인 관리자 계정으로 접속을 확인한 뒤 이전 담당자 권한을 회수하며, 기존 비밀번호를 전달하지 않는다.

### 배포 순서

1. latest Release의 tag를 main ancestry에 포함된 exact commit SHA로 해석하고 detached checkout한다. 이 SHA를 `IMAGE_TAG`로 사용한다.
2. 정상 배포 상태 파일을 읽어 동일·하위 Release이면 성공 no-op으로 종료한다. 손상된 상태 파일은 자동 보정하지 않고 배포를 중단한다.
3. lint, typecheck, test, 앱 build를 통과시킨다.
4. 현재 실행 중인 front/back 이미지 태그를 `PREV_TAG`로 캡처한다. 두 태그가 다르면 배포를 중단한다.
5. PostgreSQL을 healthy 상태로 기동하고 migration 전에 `pg_dump` backup을 접근 제한 경로에 보존한다.
6. exact SHA로 front와 back 이미지를 서버 로컬에서 각각 한 번만 빌드한다. 레지스트리에 push하거나 pull하지 않는다.
7. 6에서 빌드한 backend 이미지로 `prisma migrate deploy`를 실행한다.
8. `up -d --no-build --wait --wait-timeout <n>`로 nginx, front, back, postgres를 동일 `IMAGE_TAG`로 기동하고 `/`와 `/api/v1/health` smoke를 수행한다.
9. 모두 성공한 뒤에만 정상 Release tag와 SHA 상태 파일을 원자적으로 갱신한다.
10. 서비스 교체 또는 smoke 실패 시 로그를 보존하고 `PREV_TAG`가 있으면 이미지 rollback을 한 번 수행한다. greenfield이거나 rollback smoke도 실패하면 자동 재귀 시도 없이 수동 복구로 전환한다.

Compose 종료·재기동 절차에서 `down -v`를 실행하지 않는다. PostgreSQL 데이터는 named volume `pgdata`에 보존한다.

### 구현 진행 주석 — 첫 실동작 (2026-07-24)

- 첫 배포 실동작은 파라미터 job **수동 트리거**(`RELEASE_ACTION=published`, `RELEASE_TAG=v0.1.0`)로 검증한다. **webhook 자동 트리거는 follow-up**이며, 위 트리거·승인 경계의 HMAC 검증 webhook 계약은 [ADR-002](../../decisions/ADR-002-CI-CD-파이프라인.md) 원본을 따른다.
- webhook 인증 방식(HMAC 서명검증 대 비밀토큰)의 **개정은 별도 PR**로 진행한다. 이 문서·PR은 그 계약 문구를 바꾸지 않는다.
- GitHub read-only PAT는 release 검증 API용으로 Jenkins Credentials Store에 **준비·문서화만** 한다. `Jenkinsfile`에 인증을 적용하는 코드 변경은 follow-up이다.
- 서버 접속·설치·job·첫 Release e2e의 명령 수준 절차는 [server-runbook](../../deploy/server-runbook.md), 배포 전 로컬→EC2 단계 검증은 [pre-deploy-verify](../../deploy/pre-deploy-verify.md)를 따른다.
- 서버 접근 정보·credentials 값은 이 저장소가 아니라 **Notion credentials 페이지**가 원본이며, Notion 기록은 craft-skills aside에 위임한다. 저장소에는 항목명과 `.env.example` 변수명만 둔다.
- nginx TLS(443)/도메인/인증서는 follow-up이다. 오늘 e2e 기준은 HTTP(`/`·`/api/v1/health`)다.

## M3. 배포 서버와 개발 환경변수

### 배포 서버

1. 운영 환경 파일을 Jenkins Credentials Store의 secret file `oss-hub-production-env`로 등록한다.
2. 파일에는 운영 `POSTGRES_*` 값과 `DATABASE_URL`을 설정한다. `DATABASE_URL`은 `postgres` 서비스 DNS를 가리키고 migration과 runtime이 동일한 URL을 사용한다.
3. 저장소에는 `.env.example`만 두고 실제 운영 파일은 커밋하거나 Jenkins 로그에 출력하지 않는다.
4. Jenkins가 Compose 및 migration 단계에서만 임시 file credential을 주입하고 종료 후 workspace에 복사본을 남기지 않는지 확인한다.
5. `/var/lib/oss-hub/deploy-state`와 `/var/lib/oss-hub/backups`는 Jenkins 소유 `0700` 디렉터리로 만들고 symlink·group write를 허용하지 않는다. 생성되는 상태·backup 파일은 `0600`인지 확인한다.

### 개발 환경

1. 개발자는 Docker로 PostgreSQL 컨테이너만 실행한다.
2. 애플리케이션 실행 시 `DATABASE_URL`을 package script의 인라인 환경변수 또는 `direnv`로 주입한다.
3. 개발 `.env`를 커밋하지 않는다.
4. `pnpm` 핫리로드로 frontend와 backend를 실행하고, 연결 대상이 개발 PostgreSQL인지 확인한다.

## 복구 절차

### PREV_TAG가 있는 서비스 교체 또는 smoke 실패

1. 실패한 `up` 또는 smoke check, `docker compose ps`, Compose 로그와 Jenkins 콘솔 로그를 보존한다.
2. Compose 서비스의 이미지 태그를 `PREV_TAG`로 되돌린다.
3. `up -d --no-build --wait`로 이전 이미지를 기동한다.
4. `/`와 `/api/v1/health` smoke check를 다시 수행한다.
5. 복구 결과, 실패 SHA, `PREV_TAG`, 로그 위치를 운영 기록에 남긴다.

migration은 자동으로 되돌리지 않는다. DB 복구가 필요하면 해당 Release 직전 backup과 로그를 확인한 뒤 운영 책임자의 승인으로 수동 restore한다.

### greenfield 서비스 교체 또는 smoke 실패

`PREV_TAG`가 없는 첫 배포는 자동 rollback 대상이 없다. Jenkins 콘솔 로그와 Compose 서비스 로그를 보존하고, 배포 서버의 Jenkins build 기록 및 Compose 프로젝트 로그 위치를 운영 기록에 남긴다. 원인을 수정한 뒤 같은 SHA 규칙으로 수동 재배포한다. 데이터 볼륨 삭제를 위한 `down -v`는 사용하지 않는다.

## 완료 증거

- main branch protection 화면에서 required status check가 `ci`이고 리뷰 필수인 화면 캡처 또는 설정 기록
- PR에서 `ci`가 통과한 상태 기록
- main 검증 job과 HMAC 검증 release webhook의 분리, 허용 action·latest full Release filter 설정 기록
- Jenkins pipeline의 전용 `oss-hub-production` executor, `disableConcurrentBuilds()`, 고정 `COMPOSE_PROJECT_NAME`, exact tag SHA·main ancestry 검증 기록
- 동일·하위 Release 성공 no-op 기록
- 배포 로그의 exact `IMAGE_TAG`, migration 전 backup, 이미지 1회 build, migration, `up -d --no-build --wait` 실행 기록
- `/`와 `/api/v1/health` smoke check 결과
- `PREV_TAG` rollback 또는 greenfield 수동 복구 절차를 확인한 기록
- 운영 환경 파일은 Jenkins secret file로 비공개 관리되고 저장소에는 `.env.example`만 존재한다는 확인 기록

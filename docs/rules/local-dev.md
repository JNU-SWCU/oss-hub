# 로컬 개발 실행 런북

이 문서는 로컬에서 oss-hub를 실행하는 순서를 정리한다. 실행 명령의 원본은 각 `package.json`의 스크립트다. 이 문서는 원시 명령을 나열하지 않고 스크립트 이름 기준으로 서술한다 — drift가 생기면 스크립트 정의만 고치면 되도록 유지한다.

## 사전 준비

- Node >=24
- pnpm 11 (corepack으로 활성화)
- Docker (로컬 `postgres`, `object-storage` 서비스 기동용)
- direnv (`.envrc`를 쉘에 주입한다)

## 설정 원본

로컬 실행의 config 원본은 `.envrc`(direnv) 하나다. 처음 쓸 때는 `.envrc.example`을 `.envrc`로 복사하고 그 안의 "직접 채운다" 항목(세션 서명 키 2개, dev OAuth 값)을 채운 뒤 `direnv allow`한다. `.envrc`는 추적하지 않는다.

`.env.example`은 production Compose(`compose.yml`)가 요구하는 키 목록이며 로컬 실행 경로가 읽지 않는다. `scripts/check-env-example-coverage.mjs`가 compose 필수 키 문서화·코드 소비 키 선언·소유 서비스 environment 매핑을 검사한다(TypeScript AST + `docker compose config`).

## 실행 경로

`pnpm dev`가 유일한 실행 경로다. backend·frontend는 **호스트 프로세스**로 hot reload하고, 인프라(PostgreSQL·object-storage)만 `compose.dev.yml`로 Docker에서 띄운다. 앱이 호스트에 있으므로 모든 호스트명이 `localhost`이고 포트는 `compose.dev.yml`이 publish한 것을 쓴다.

- `pnpm dev`는 필수 env와 포트 3000·4000 점유를 먼저 검사하고, 인프라 기동과 마이그레이션 적용까지 마친 뒤 두 watcher를 함께 띄운다. 한쪽 watcher가 죽으면 다른 쪽도 함께 내려간다.
- 스키마를 바꿨다면 마이그레이션 파일 생성은 `pnpm db:migrate:dev`가 담당한다. `pnpm dev`는 이미 있는 마이그레이션을 적용하기만 한다.
- GitHub App 개인키는 **파일 경로**로 전달한다. 호스트 파일은 추적하지 않는 `secrets/`에 두고, `.envrc`가 가리키는 호스트 파일 경로를 쓴다.
- 주의: 호스트 쉘에 이미 export된 `*_PRIVATE_KEY_FILE` 등은 `.envrc`가 다시 export할 때까지 이전 값이 남아 있을 수 있다. `direnv allow` 뒤 값이 기대와 다르면 쉘을 새로 연다.

## 실행 순서

1. `pnpm install` — 의존성 설치. `postinstall`에서 backend의 `prisma generate`가 자동 실행된다.
2. `.envrc.example`을 `.envrc`로 복사하고 "직접 채운다" 항목을 채운 뒤 `direnv allow`.
3. `pnpm dev` — 인프라 기동·마이그레이션 적용·backend·frontend watcher를 순서대로 띄운다.

접속은 `http://localhost:3000`(frontend)이다. `/api/v1/*` 요청은 `next.config.ts`의 rewrite를 거쳐 backend(`http://localhost:4000`)로 전달된다.

## GitHub OAuth 로컬 로그인

OAuth 콜백은 `FRONTEND_URL`에서 파생되므로 `http://localhost:3000/api/v1/auth/github/callback`이다. dev GitHub OAuth App에 이미 등록된 값이라 추가 설정이 필요 없다. `FRONTEND_URL`이나 포트를 바꾸면 OAuth App 등록도 함께 바꿔야 한다.

역할별 테스트 계정은 `AUTH_INITIAL_ROLES`로 준비한다. 자세한 절차는 [onboarding](../onboarding.md)을 따른다.

## 동작 참고

- 운영은 host nginx가 공인 80/443과 TLS를 담당하고 Compose nginx가 `127.0.0.1:8081`만 bind한다([ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)). **8081은 내부 hop이라 콜백 URL에 등장하지 않는다.** 로컬 `pnpm dev`에는 nginx가 없다 — frontend가 3000을 직접 bind하고 `next.config.ts` rewrite가 backend로 프록시한다.
- `pnpm db:up`과 `pnpm --filter backend test:integration`은 `compose.dev.yml`을 단독으로 쓴다.
- 스키마를 바꿨다면 `pnpm db:migrate:dev`로 마이그레이션을 생성한다. 이 스크립트는 호스트에서 prisma CLI를 직접 돌리므로 `.envrc`의 `DATABASE_URL`(호스트 `localhost`)을 쓴다.
- `db:migrate:dev`·`db:reset`·`db:seed`·`notifications:send-digest`는 실행 전 `scripts/check-host-db-url.sh`가 `DATABASE_URL`을 검증한다. 로컬이 아닌 호스트를 가리키거나 `POSTGRES_PORT`·`POSTGRES_DB` override와 어긋나면 거부한다 — `db:reset`이 `prisma migrate reset --force`라 override 시 다른 데이터베이스를 지울 수 있었다. 자격증명은 어떤 경로에서도 출력하지 않는다.
- production은 승인된 object storage 설정과 migration이 모두 준비되지 않으면 backend를 fail-closed로 유지하며 로컬 기본값을 사용하지 않는다.
- 배포 전 production-like 통합 검증은 CI required check와 Jenkins release 경로(image build, `prisma migrate deploy`, `nginx -t`, health/rollback smoke)가 맡는다. 자세한 절차는 [pre-deploy-verify](../deploy/pre-deploy-verify.md)를 따른다.

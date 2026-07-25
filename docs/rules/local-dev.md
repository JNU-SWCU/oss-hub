# 로컬 개발 실행 런북

이 문서는 로컬에서 oss-hub를 실행하는 순서를 정리한다. 실행 명령의 원본은 각 `package.json`의 스크립트다. 이 문서는 원시 명령을 나열하지 않고 스크립트 이름 기준으로 서술한다 — drift가 생기면 스크립트 정의만 고치면 되도록 유지한다.

## 사전 준비

- Node >=24
- pnpm 11 (corepack으로 활성화)
- Docker (로컬 `postgres`, `minio`, `minio-bucket` 서비스 기동용)

## 실행 순서

1. `pnpm install` — 의존성 설치. `postinstall`에서 backend의 `prisma generate`가 자동 실행된다.
2. `pnpm db:up` — `compose.dev.yml`의 `postgres`와 `minio`가 healthy가 된 뒤 `minio-bucket`이 제출 파일 bucket을 생성·비공개화할 때까지 기다린다.
3. `pnpm db:migrate:dev` — `pnpm db:up` 완료 뒤 최초 실행이거나 스키마 변경 후에만 실행한다.
4. `pnpm --filter backend dev` — storage와 DB 준비 뒤 NestJS 서버를 시작하며 `PORT` 미설정 시 4000에서 열린다.
5. `pnpm --filter frontend dev` — backend 준비 뒤 Next.js 서버를 시작하며 3000에서 열린다.

## 동작 참고

- frontend dev 모드는 `/api/v1/*` 요청을 `BACKEND_ORIGIN`(기본값 `http://localhost:4000`)으로 rewrite한다 (`apps/frontend/next.config.ts`).
- backend `dev` 스크립트에는 개발용 `DATABASE_URL`이 이미 내장돼 있어 별도 env 설정이 필요 없다. 값은 `apps/backend/package.json`의 backend `dev` 스크립트 정의가 원본이다.
- 종료 시 `compose.dev.yml`의 `postgres`, `minio`, `minio-bucket` 서비스를 함께 정리한다.
- production은 승인된 object storage 설정과 migration이 모두 준비되지 않으면 backend를 fail-closed로 유지하며 로컬 기본값을 사용하지 않는다.

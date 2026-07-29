# 로컬 개발 실행 런북

이 문서는 로컬에서 oss-hub를 실행하는 순서를 정리한다. 실행 명령의 원본은 각 `package.json`의 스크립트다. 이 문서는 원시 명령을 나열하지 않고 스크립트 이름 기준으로 서술한다 — drift가 생기면 스크립트 정의만 고치면 되도록 유지한다.

## 사전 준비

- Node >=24
- pnpm 11 (corepack으로 활성화)
- Docker (로컬 `postgres`, `minio`, `minio-bucket` 서비스 기동용)

## 설정 원본

로컬 설정의 원본은 저장소 루트 `.env` 하나다. 운영도 같은 구조다 — Jenkins가 `oss-hub-production-env` 파일 credential을 주입하고 `compose.yml`이 명시 매핑으로 컨테이너에 전달한다. 로컬을 같은 경로로 맞춰 두어야 "로컬에서는 되는데 운영에서 안 되는" 설정 차이가 생기지 않는다.

`.env.example`이 필요한 키의 목록이다. `scripts/check-env-example-coverage.mjs`가 compose 필수 키 문서화·코드 소비 키 선언·소유 서비스 environment 매핑을 검사한다(TypeScript AST + `docker compose config`).

주의 두 가지가 있다.

- `.env`에 같은 키를 두 번 쓰지 않는다. Docker Compose는 `--env-file`에서 **먼저 나온 항목**을 쓰므로 뒤에 덧붙인 값은 무시된다.
- 호스트 쉘에 export된 환경변수는 `--env-file`보다 **우선한다**. `scripts/docker-verify-local.sh`는 이 때문에 `.env`가 소유해야 할 키를 먼저 `unset`한다.

## 실행 순서

1. `pnpm install` — 의존성 설치. `postinstall`에서 backend의 `prisma generate`가 자동 실행된다.
2. `.env` 준비 — `.env.example`을 기준으로 값을 채운다. compose 경로로 띄우므로 서비스 DNS를 쓴다: `DATABASE_URL`의 호스트는 `postgres`, `SUBMISSION_FILE_S3_ENDPOINT`는 `http://minio:9000`이다. `FRONTEND_URL`은 ingress와 같은 `http://localhost:3000`이어야 한다. 이 값은 dev GitHub OAuth App에 이미 등록된 콜백 origin과 일치해야 한다.
3. `pnpm local:build` — backend·frontend 이미지를 빌드한다. `IMAGE_TAG`는 환경변수가 있으면 그것을, 없으면 `.env`의 값을 쓴다. `.env.example`은 로컬용 placeholder(`local`)를 포함하므로 복사 후 그대로 쓸 수 있고, CI·Jenkins는 검증된 SHA를 주입한다.
4. `pnpm local:up` — `compose.yml` + `compose.dev.yml` + `compose.local.yml` 세 파일을 조합해 postgres·minio·backend·frontend·nginx를 띄운다.
5. `pnpm local:verify` — 위 기동에 더해 마이그레이션 적용, DB·HTTP·MinIO smoke, `minio-bucket` 재시작·재생성 검증까지 수행한다.

접속은 nginx ingress인 `http://localhost:3000`이다. `/`는 프론트, `/api/v1/*`는 backend로 라우팅된다.

## GitHub OAuth 로컬 로그인

OAuth 콜백은 `FRONTEND_URL`에서 파생되므로 compose 경로에서는 `http://localhost:3000/api/v1/auth/github/callback`이다. dev GitHub OAuth App에 이미 등록된 값이라 추가 설정이 필요 없다. `FRONTEND_URL`이나 ingress 포트를 바꾸면 OAuth App 등록도 함께 바꿔야 한다.

역할별 테스트 계정은 `AUTH_INITIAL_ROLES`로 준비한다. 자세한 절차는 [onboarding](../onboarding.md)을 따른다.

## 동작 참고

- 운영은 host nginx가 공인 80/443과 TLS를 담당하고 Compose nginx가 `127.0.0.1:8081`만 bind한다([ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)). **8081은 내부 hop이라 콜백 URL에 등장하지 않는다.** 로컬에는 host nginx가 없어 Compose ingress가 곧 브라우저 대면 주소이므로 `compose.local.yml`이 3000으로 override한다. `compose.yml`의 운영 8081은 그대로다.
- `pnpm db:up`과 `pnpm --filter backend test:integration`은 여전히 `compose.dev.yml`을 단독으로 쓴다. 이 경로는 그대로 유효하다.
- 스키마를 바꿨다면 `pnpm db:migrate:dev`로 마이그레이션을 생성한다. 이 스크립트는 호스트에서 prisma CLI를 직접 돌리므로 `localhost` 연결 문자열을 인라인으로 갖는다. compose 경로의 `DATABASE_URL`(호스트 `postgres`)과 목적이 다르다.
- `pnpm local:verify`는 임시 포트(`POSTGRES_PORT=0`, `MINIO_PORT=0`)와 매 실행 고유한 project name을 써서 선행 `pnpm db:up` 스택과 충돌하지 않는다. 다만 ingress 포트(기본 3000)는 콜백 origin에 묶여 고정이라 점유 중이면 preflight에서 실패한다.
- 종료 시 `local:verify`는 자신이 만든 컨테이너와 볼륨을 정리한다.
- production은 승인된 object storage 설정과 migration이 모두 준비되지 않으면 backend를 fail-closed로 유지하며 로컬 기본값을 사용하지 않는다.

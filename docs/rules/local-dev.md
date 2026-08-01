# 로컬 개발 실행 런북

이 문서는 로컬에서 oss-hub를 실행하는 순서를 정리한다. 실행 명령의 원본은 각 `package.json`의 스크립트다. 이 문서는 원시 명령을 나열하지 않고 스크립트 이름 기준으로 서술한다 — drift가 생기면 스크립트 정의만 고치면 되도록 유지한다.

## 사전 준비

- Node >=24
- pnpm 11 (corepack으로 활성화)
- Docker (로컬 `postgres`, `minio`, `minio-bucket` 서비스 기동용)
- direnv (호스트 hot reload 경로에서 `.envrc`를 쉘에 주입한다 — 아래 "두 실행 경로" 참고)

## 설정 원본

로컬 설정의 원본은 저장소 루트 `.env` 하나다. 운영도 같은 구조다 — Jenkins가 `oss-hub-production-env` 파일 credential을 주입하고 `compose.yml`이 명시 매핑으로 컨테이너에 전달한다. 로컬을 같은 경로로 맞춰 두어야 "로컬에서는 되는데 운영에서 안 되는" 설정 차이가 생기지 않는다.

`.env.example`이 필요한 키의 목록이다. `scripts/check-env-example-coverage.mjs`가 compose 필수 키 문서화·코드 소비 키 선언·소유 서비스 environment 매핑을 검사한다(TypeScript AST + `docker compose config`).

주의 두 가지가 있다.

- `.env`에 같은 키를 두 번 쓰지 않는다. Docker Compose는 `--env-file`에서 **먼저 나온 항목**을 쓰므로 뒤에 덧붙인 값은 무시된다.
- 호스트 쉘에 export된 환경변수는 `--env-file`보다 **우선한다**. `scripts/docker-verify-local.sh`는 이 때문에 `.env`가 소유해야 할 키를 먼저 `unset`한다.

## 두 실행 경로

로컬 실행 경로는 두 가지이고 목적이 다르다. **호스트 ingress 3000을 공유하므로 동시에 띄울 수 없다.**

| 경로 | 무엇이 어디서 도는가 | env 원본 | 쓰는 때 |
| --- | --- | --- | --- |
| `pnpm dev` | backend·frontend는 **호스트 프로세스**(hot reload), 인프라만 Docker | `.envrc` (direnv) | 일상 개발 |
| `pnpm local:up` · `pnpm local:verify` | 앱까지 컨테이너 — production 구조와 같은 경로 | `.env` | 배포 전 통합 검증 |

두 경로의 env 파일은 값이 다르다. `pnpm dev`는 앱이 호스트에 있으니 호스트명이 전부 `localhost`이고, compose 경로는 서비스 DNS(`postgres`, `minio`)를 쓴다. 값을 서로 복사하면 연결이 깨진다.

`pnpm dev`를 처음 쓸 때는 `.envrc.example`을 `.envrc`로 복사하고 그 안의 "직접 채운다" 항목(세션 서명 키 2개, dev OAuth 값)을 채운 뒤 direnv를 허용한다. `.envrc`는 추적하지 않는다.

- `pnpm dev`는 필수 env와 포트 3000·4000 점유를 먼저 검사하고, 인프라 기동과 마이그레이션 적용까지 마친 뒤 두 watcher를 함께 띄운다. 한쪽 watcher가 죽으면 다른 쪽도 함께 내려간다.
- 스키마를 바꿨다면 마이그레이션 파일 생성은 `pnpm db:migrate:dev`가 담당한다. `pnpm dev`는 이미 있는 마이그레이션을 적용하기만 한다.
- GitHub App 개인키는 실행 경로마다 **파일 경로**로 전달한다. 호스트 파일은 추적하지 않는 `secrets/`에 두고, `pnpm dev`에서는 `.envrc`가 가리키는 호스트 파일 경로를 사용한다. `pnpm local:up`·`pnpm local:verify`에서는 `*_PRIVATE_KEY_SOURCE`가 호스트 경로, `*_PRIVATE_KEY_FILE`이 컨테이너 안 경로(`/run/secrets/...`)를 뜻한다.
- 주의: 호스트 쉘에 export된 `*_PRIVATE_KEY_FILE`은 compose의 `--env-file`보다 우선한다. 그래서 `.envrc`가 같은 키를 export한 상태로 compose 검증을 돌리면, 컨테이너 안에 없는 호스트 경로가 덮어써진다.

## 실행 순서

아래는 compose 경로(`pnpm local:up`) 기준이다. 호스트 hot reload는 위 "두 실행 경로"를 따른다.

1. `pnpm install` — 의존성 설치. `postinstall`에서 backend의 `prisma generate`가 자동 실행된다.
2. `.env` 준비 — `.env.example`을 기준으로 값을 채운다. compose 경로로 띄우므로 서비스 DNS를 쓴다: `DATABASE_URL`의 호스트는 `postgres`, `SUBMISSION_FILE_S3_ENDPOINT`는 `http://minio:9000`이다. `FRONTEND_URL`은 ingress와 같은 `http://localhost:3000`이어야 한다. 이 값은 dev GitHub OAuth App에 이미 등록된 콜백 origin과 일치해야 한다.
3. `pnpm local:up` — `compose.yml` + `compose.local.yml` 두 파일을 조합하고 저장소 Dockerfile로 backend·frontend 이미지를 빌드해 postgres·minio·backend·frontend·nginx를 띄운다. `IMAGE_TAG`는 필요하지 않는다.
4. `pnpm local:verify` — 위 빌드·기동에 더해 마이그레이션 적용, DB·HTTP·MinIO smoke, `minio-bucket` 재시작·재생성 검증까지 수행한다.

접속은 nginx ingress인 `http://localhost:3000`이다. `/`는 프론트, `/api/v1/*`는 backend로 라우팅된다.

## GitHub OAuth 로컬 로그인

OAuth 콜백은 `FRONTEND_URL`에서 파생되므로 compose 경로에서는 `http://localhost:3000/api/v1/auth/github/callback`이다. dev GitHub OAuth App에 이미 등록된 값이라 추가 설정이 필요 없다. `FRONTEND_URL`이나 ingress 포트를 바꾸면 OAuth App 등록도 함께 바꿔야 한다.

역할별 테스트 계정은 `AUTH_INITIAL_ROLES`로 준비한다. 자세한 절차는 [onboarding](../onboarding.md)을 따른다.

## 동작 참고

- 운영은 host nginx가 공인 80/443과 TLS를 담당하고 Compose nginx가 `127.0.0.1:8081`만 bind한다([ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)). **8081은 내부 hop이라 콜백 URL에 등장하지 않는다.** 로컬에는 host nginx가 없어 Compose ingress가 곧 브라우저 대면 주소이므로 `compose.local.yml`이 3000으로 override한다. `compose.yml`의 운영 8081은 그대로다.
- `pnpm db:up`과 `pnpm --filter backend test:integration`은 여전히 `compose.dev.yml`을 단독으로 쓴다. 이 경로는 그대로 유효하다.
- 스키마를 바꿨다면 `pnpm db:migrate:dev`로 마이그레이션을 생성한다. 이 스크립트는 호스트에서 prisma CLI를 직접 돌리므로 `.envrc`의 `DATABASE_URL`(호스트 `localhost`)을 쓴다. compose 경로의 `DATABASE_URL`(호스트 `postgres`)과 목적이 다르다.
- `db:migrate:dev`·`db:reset`·`db:seed`·`notifications:send-digest`는 실행 전 `scripts/check-host-db-url.sh`가 `DATABASE_URL`을 검증한다. 로컬이 아닌 호스트를 가리키거나 `POSTGRES_PORT`·`POSTGRES_DB` override와 어긋나면 거부한다 — `db:reset`이 `prisma migrate reset --force`라 override 시 다른 데이터베이스를 지울 수 있었다. 자격증명은 어떤 경로에서도 출력하지 않는다.
- `pnpm local:verify`는 매 실행 고유한 project name을 쓰고 PostgreSQL·MinIO host port를 공개하지 않아 선행 `pnpm db:up` 스택과 충돌하지 않는다. 다만 ingress 포트(기본 3000)는 콜백 origin에 묶여 고정이라 점유 중이면 preflight에서 실패한다.
- 종료 시 `local:verify`는 자신이 만든 컨테이너와 볼륨을 정리한다.
- production은 승인된 object storage 설정과 migration이 모두 준비되지 않으면 backend를 fail-closed로 유지하며 로컬 기본값을 사용하지 않는다.

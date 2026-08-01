# CI 경로별 검증 계약

이 문서는 변경 경로가 어떤 검증을 실행해야 하는지 정한다.
경로 감지는 required `ci` job 안에서 수행하므로 대상 변경이 없어도 `ci` 결과는 항상 보고된다.
`.github/workflows/**` 변경은 아래의 모든 경로별 검증을 실행해 검증 규칙 자체의 누락을 막는다.

이 표는 이미 존재하는 검증을 경로에 매핑할 뿐, 새 계약마다 전용 검사기를 만들 근거는 아니다.
어떤 수단으로 불변식을 지킬지는 [ADR-005](../decisions/ADR-005-agent-driven-review-cycle.md)의 우선순위(구조 → 앱 테스트 → 전용 검사기 → 문서 규칙)가 원본이다.
상위 수단으로 성립하는 불변식은 이 표에 행을 추가하지 않고, 검사기를 상위 수단으로 옮기면 해당 행을 지운다.

| 변경 경로 | 실행하는 검증 | 경계 |
| --- | --- | --- |
| `apps/frontend/**` | frontend lint · typecheck · test · build | Docker 이미지 빌드 없음 |
| `apps/backend/**` | backend lint · typecheck · test · build | Docker 이미지 빌드 없음 |
| `deploy/nginx/**`, `deploy/host-nginx/**`, `scripts/check-submission-upload-route*.sh` | `probe-nginx-callback-log.sh` 합성 callback 로그 계약 + `check-host-nginx.test.sh` IP TLS·ACME·loopback Compose·POST-only Jenkins 계약 + `check-submission-upload-route.test.sh`/실제 설정의 upload 403 차단 계약 — nginx location 선택 규칙(`=` → `^~` → 정규식 선언 순서 → 최장 prefix)을 모사해 exact·descendant와 대소문자 변형(`/api/v1/Submission-Files`)이 모두 fail-closed로 선택되고 sibling(`submission-files-export`)은 차단되지 않음을 검사한다. Nest(Express) 라우팅이 대소문자를 구분하지 않으므로 대소문자를 구분하는 deny 는 그 자체로 우회다 | 실제 OAuth·인증서 값·요청·업로드 없음. 저장소 파일만 읽으므로 **실행 중 컨테이너의 설정이 저장소와 같다는 증거는 아니다** — 그 계약은 [ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)의 배포 smoke가 증명한다 |
| `compose.yml`, `compose.local.yml`, `.env.example`, `scripts/check-env-example-coverage*.mjs`, `scripts/docker-verify-local*.sh`, `scripts/_compose-lib.sh`, `apps/backend/src/**`, `apps/frontend/src/**` | (A) `node --test scripts/check-env-example-coverage.test.mjs` fixture 회귀 + `node scripts/check-env-example-coverage.mjs --require-docker` 집합 계약. E=`.env.example` 키, Q=Compose 필수 `${VAR:?}`·`${VAR?}` 키, R=`RUNTIME_CONFIG_KEYS`, P=loader property, L=loader `env.KEY` 읽기, B=Docker 정규화 `services.backend.environment`으로 `R=P=L`, `Q-{IMAGE_TAG}⊆E`, `R-면제⊆E`, `R-면제⊆B`, `AUTH_INITIAL_ROLES∈B`를 검사한다. canonical loader는 직접 `return Object.freeze({ KEY: env.KEY })`여야 하며 반쪽 편집·중복·default·spread를 fail-closed한다. 일반 소스의 `process.env` 금지는 ESLint가 소유한다. (B) `bash scripts/docker-verify-local.test.sh` — 로컬 실행 계약은 정확히 `compose.yml` + `compose.local.yml` 두 파일이며 호출자 `IMAGE_TAG` 없이 성립한다. production `compose.yml` 단독의 `${IMAGE_TAG:?}` fail-closed는 유지한다. | (A) 컨테이너 기동·이미지 빌드 없음. 의존: Docker Compose CLI. CI workflow는 `--require-docker`를 명시 전달하며 docker 부재 시 실패한다. 로컬 docker 부재 시 service-mapping·compose-config만 stderr에 명시 skip하고 선언·manifest·loader 검사는 유지한다. 세 번째 positional `scanRoot`는 호환성 이름을 유지하되 소스 스캔 루트가 아니라 canonical `apps/backend/src/runtime-config/runtime-config.ts`를 찾는 contract root다. 면제 원장: `IMAGE_TAG`는 Compose 문서화만, `NODE_ENV`·`DIGEST_FORCE_TO`는 runtime 문서화·backend 주입, `SUBMISSION_FILE_CLEANUP_*`·`GITHUB_COLLECTION_APP_SMOKE_*`는 backend 주입만 면제한다. |
| `Jenkinsfile`, `scripts/check-jenkinsfile.sh`, `scripts/check-jenkinsfile.test.sh`, `scripts/prune-deploy-backups*.sh`, `scripts/jenkins/**` | `bash scripts/check-jenkinsfile.test.sh` 합성 fixture 회귀 + `bash scripts/check-jenkinsfile.sh Jenkinsfile` 단일 parameterless latest-Release 계약 + `bash scripts/prune-deploy-backups.test.sh` 격리 N+1 보존 계약. 실행 중 no-op·fail-closed stopped/ambiguous·SemVer downgrade·OCI label·rollback Image ID 바인딩·success-only retention을 검증한다. | Jenkins 실행·이미지 빌드·실제 backup 접근 없음 |
| `apps/*/Dockerfile`, `.dockerignore` | `check-docker-context.test.sh`와 실제 context의 deny 규칙·COPY 경계 검사 | Docker daemon·이미지 빌드 없음 |
| `scripts/check-public-safe*.sh` | shell 문법 검사 + `public-safe` job의 regex 회귀 테스트 | PR-controlled 코드에 secret 미주입 |
| `scripts/team-state-check*.mjs` | Node 문법 검사 + TEAM-STATE 합성 fixture 단위테스트 | GitHub 조회 실패를 성공으로 추정하지 않음 |
| `scripts/check-host-db-url*.sh` | shell 문법 검사 + `bash scripts/check-host-db-url.test.sh` 회귀. 호스트 lane `DATABASE_URL`이 로컬을 가리키는지, `POSTGRES_PORT`·`POSTGRES_DB` override와 일치하는지, 실패 경로에서 자격증명을 출력하지 않는지 검증한다 | 실제 DB 연결·마이그레이션 실행 없음. 가드는 파괴적 명령(`prisma migrate reset --force`)의 대상만 검증하고 prisma를 호출하지 않는다 |
| 그 밖의 `scripts/*.sh`, `scripts/*.mjs` | 각 런타임의 문법 검사 | 외부 서비스·실데이터 사용 없음 |

`public-safe`는 경로와 무관하게 모든 PR에서 실행한다.
TEAM-STATE 단위테스트도 required `ci`에서 항상 실행하며, 실제 GitHub drift 조회는 별도의 advisory job이 담당한다.
이 계약은 검증 대상을 선택할 뿐 배포·정책 상태·문서를 자동 변경하지 않는다.

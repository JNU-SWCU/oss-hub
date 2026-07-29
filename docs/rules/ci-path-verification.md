# CI 경로별 검증 계약

이 문서는 변경 경로가 어떤 검증을 실행해야 하는지 정한다. 경로 감지는 required `ci` job 안에서
수행하므로 대상 변경이 없어도 `ci` 결과는 항상 보고된다. `.github/workflows/**` 변경은 아래의 모든
경로별 검증을 실행해 검증 규칙 자체의 누락을 막는다.

| 변경 경로 | 실행하는 검증 | 경계 |
| --- | --- | --- |
| `apps/frontend/**` | frontend lint · typecheck · test · build | Docker 이미지 빌드 없음 |
| `apps/backend/**` | backend lint · typecheck · test · build | Docker 이미지 빌드 없음 |
| `deploy/nginx/**`, `deploy/host-nginx/**` | `probe-nginx-callback-log.sh`의 합성 callback 로그 계약 + `check-host-nginx.test.sh`의 IP TLS·ACME·loopback Compose·POST-only Jenkins 계약 | 실제 OAuth·인증서 값·요청 없음 |
| `compose.yml`, `.env.example`, `scripts/check-env-example-coverage*.mjs`, `apps/backend/src/**`, `apps/frontend/src/**` | `node --test scripts/check-env-example-coverage.test.mjs` fixture 회귀 + `node scripts/check-env-example-coverage.mjs --require-docker` 삼중 계약. (1) 선언: compose `${VAR:?}`·코드 소비 키 → `.env.example`. (2) 주입: 코드 소비 키 → 소유 서비스 `environment` — `docker compose config --format json` 정규화 모델로 판정. (3) 소비: `apps/*/src` 비테스트 소스를 TypeScript AST로 스캔. 지원 접근: `process.env.KEY`, `process.env['KEY']`/`"KEY"`/\`KEY\`, `const { KEY } = process.env`(rename·default는 property key만), `env.KEY`, `environmentValue`/`booleanEnvironmentValue('KEY')`, `NAME_ENV = 'KEY'`, 접두 필터된 `GITHUB_*`/`SUBMISSION_FILE_*` config 리터럴. 승인 helper 면제는 정의 파일 경로+선언 쌍으로만 적용하며 본문의 `process.env[<param>]`만 동적 접근 면제. 승인 helper 호출 첫 인자가 정적 리터럴이 아니면 실패. 스캔 확장자: `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs`. parse diagnostics·디렉터리 순회 오류는 이름 있는 검사 실패. compose 필수 보간은 `${VAR:?}`·`${VAR?}`(주석·`$$` 이스케이프 제외). | 컨테이너 기동·이미지 빌드 없음. 의존: Docker Compose CLI·`typescript`(apps/backend). CI workflow는 `--require-docker`를 명시 전달하며 docker 부재 시 실패. 로컬 docker 부재 시 service-mapping·compose-config만 stderr에 명시 skip하고 선언 검사는 유지. typescript 부재는 즉시 실패(`pnpm install` 안내). 면제: `NODE_ENV`(Dockerfile·compose.local.yml 소유 전역 예외), `DIGEST_FORCE_TO`(`notifications/cli`), `OSS_HUB_INTEGRATION_RUNNER`(`*.integration.spec.ts`만; 스캔 제외 대상과 일치), `SUBMISSION_FILE_CLEANUP_*`(`submissions/cli`), `GITHUB_COLLECTION_APP_SMOKE_*`(`collection/cli`), `IMAGE_TAG`(image 치환·매핑 면제, `${:?}`면 `.env.example` 문서화). 동적 `process.env[var]` 면제는 승인 경로(`repositories/github-operations.config.ts`·`submissions/submission-file-storage.config.ts`)의 **유일한 top-level 함수 선언**에만 적용하며, 같은 이름의 중복·중첩·메서드 선언이 있으면 판별 불가로 실패한다. |
| `Jenkinsfile` | `check-jenkinsfile.test.sh`와 실제 파일의 배포 불변식 검사 | Jenkins 실행·이미지 빌드 없음 |
| `apps/*/Dockerfile`, `.dockerignore` | `check-docker-context.test.sh`와 실제 context의 deny 규칙·COPY 경계 검사 | Docker daemon·이미지 빌드 없음 |
| `scripts/check-public-safe*.sh` | shell 문법 검사 + `public-safe` job의 regex 회귀 테스트 | PR-controlled 코드에 secret 미주입 |
| `scripts/team-state-check*.mjs` | Node 문법 검사 + TEAM-STATE 합성 fixture 단위테스트 | GitHub 조회 실패를 성공으로 추정하지 않음 |
| 그 밖의 `scripts/*.sh`, `scripts/*.mjs` | 각 런타임의 문법 검사 | 외부 서비스·실데이터 사용 없음 |

`public-safe`는 경로와 무관하게 모든 PR에서 실행한다. TEAM-STATE 단위테스트도 required `ci`에서 항상
실행하며, 실제 GitHub drift 조회는 별도의 advisory job이 담당한다. 이 계약은 검증 대상을 선택할 뿐
배포·정책 상태·문서를 자동 변경하지 않는다.

# CI 경로별 검증 계약

이 문서는 변경 경로가 어떤 검증을 실행해야 하는지 정한다. 경로 감지는 required `ci` job 안에서
수행하므로 대상 변경이 없어도 `ci` 결과는 항상 보고된다. `.github/workflows/**` 변경은 아래의 모든
경로별 검증을 실행해 검증 규칙 자체의 누락을 막는다.

| 변경 경로 | 실행하는 검증 | 경계 |
| --- | --- | --- |
| `apps/frontend/**` | frontend lint · typecheck · test · build | Docker 이미지 빌드 없음 |
| `apps/backend/**` | backend lint · typecheck · test · build | Docker 이미지 빌드 없음 |
| `deploy/nginx/**` | `probe-nginx-callback-log.sh`의 합성 callback 로그 계약 | 실제 OAuth 값·요청 없음 |
| `compose.yml`, `.env.example` | `.env.example`을 파싱하고 합성 process env만 주입한 `docker compose config --quiet` | 컨테이너 기동·이미지 빌드 없음 |
| `Jenkinsfile` | `check-jenkinsfile.test.sh`와 실제 파일의 배포 불변식 검사 | Jenkins 실행·이미지 빌드 없음 |
| `apps/*/Dockerfile`, `.dockerignore` | `check-docker-context.test.sh`와 실제 context의 deny 규칙·COPY 경계 검사 | Docker daemon·이미지 빌드 없음 |
| `scripts/check-public-safe*.sh` | shell 문법 검사 + `public-safe` job의 regex 회귀 테스트 | PR-controlled 코드에 secret 미주입 |
| `scripts/team-state-check*.mjs` | Node 문법 검사 + TEAM-STATE 합성 fixture 단위테스트 | GitHub 조회 실패를 성공으로 추정하지 않음 |
| 그 밖의 `scripts/*.sh`, `scripts/*.mjs` | 각 런타임의 문법 검사 | 외부 서비스·실데이터 사용 없음 |

`public-safe`는 경로와 무관하게 모든 PR에서 실행한다. TEAM-STATE 단위테스트도 required `ci`에서 항상
실행하며, 실제 GitHub drift 조회는 별도의 advisory job이 담당한다. 이 계약은 검증 대상을 선택할 뿐
배포·정책 상태·문서를 자동 변경하지 않는다.

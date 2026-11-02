# 캡처용 격리 스택

가이드 화면은 실제 제품을 로컬에 따로 띄워 찍습니다. 운영 서비스나 개발자 개인 DB를 쓰지 않습니다. 확인한 내용과 확인하지 못한 내용을 구분해 적습니다.

## 고정값

| 항목 | 값 |
|---|---|
| compose 프로젝트 | `oss-hub-guide` (`docker compose -p oss-hub-guide -f compose.dev.yml`) |
| Postgres | 호스트 55432 (컨테이너 `oss-hub-guide-postgres-1`) |
| 오브젝트 스토리지(s3mock) | 호스트 59000 |
| 프런트 | 3310 |
| 백엔드 | 4310 |
| 메일 | `MAIL_MODE=dry-run` (실제 메일 없음) |
| GitHub | 자격 증명 없음. 저장소 자동 생성 같은 호출은 일어나지 않습니다 |
| 시드 | `SEED_PROFILE=demo pnpm exec prisma db seed` (apps/backend에서) |

값 묶음은 `skills/build-user-guide-site/scripts/stack.env.example`에 있습니다. 이것은 `.envrc.example` 위에 덮어쓰는 값이며, 나머지 변수(`DATABASE_URL`, OAuth 변수 등)는 `.envrc.example`에서 가져옵니다. `DATABASE_URL`은 `.envrc.example` 값에서 포트만 `55432`로 바꿉니다. 비밀번호 같은 값을 이 스킬에 적지 않습니다.

## 비밀 값

- `SESSION_SECRET`: base64url 인코딩이며 디코딩하면 32바이트 이상이어야 합니다(확인함). 예: `openssl rand -base64 48 | tr '+/' '-_' | tr -d '='`.
- `TEAM_JOIN_CODE_SECRET`: 필수입니다. 형식은 확인하지 못했습니다(확인 필요). 같은 방식으로 만든 임의 문자열로 시작해 백엔드가 받아들이는지 보세요.
- 값은 셸 환경 변수로만 전달하고 파일이나 스킬, 커밋에 남기지 않습니다. `.env` 값은 읽지도 복사하지도 않습니다. 캡처 라이브러리는 같은 `SESSION_SECRET`을 환경 변수로 받아 세션 토큰을 만듭니다.

## 띄우는 순서

1. 환경: `stack.env.example`을 `source`하고 `SESSION_SECRET`, `TEAM_JOIN_CODE_SECRET`을 채웁니다. 나머지 변수는 `.envrc.example`에서 옮깁니다.
2. 인프라: `docker compose -p oss-hub-guide -f compose.dev.yml up -d postgres object-storage` (컨테이너 이름은 `docker ps`로 확인했습니다. 서비스 이름은 compose 파일에서 확인하세요).
3. 마이그레이션: `pnpm --filter backend exec prisma migrate deploy`.
4. 시드: `cd apps/backend && SEED_PROFILE=demo pnpm exec prisma db seed`.
5. 가이드용 상태: 준비 SQL을 `docker exec -i oss-hub-guide-postgres-1 psql -U oss -d oss_hub -v ON_ERROR_STOP=1 < <G>/prepare-db.sql`로 적용합니다. 합성 행을 더 넣을 때도 같은 명령을 씁니다.
6. 백엔드: `apps/backend`에서 `PORT=4310`으로 `nest start`를 직접 시작합니다. `/my-repos`가 동작하려면 `GITHUB_APP_ORG=JNU-SWCU`가 필요합니다.
7. 프런트: `PORT=3310`으로 `next dev`. 프런트는 `BACKEND_ORIGIN`으로 백엔드를 찾습니다.
8. 점검: `curl http://localhost:4310/api/v1/health`가 응답하면 백엔드가 떠 있습니다(공개 엔드포인트, 확인함). 이어 `node skills/build-user-guide-site/scripts/smoke.mjs <login> /` 로 페이지를 점검합니다.

확인하지 못한 것: 위 명령의 플래그 조합은 표준 형태로 적었습니다. 막히면 `compose.dev.yml`과 `apps/backend/package.json`을 읽고 맞추세요. `DATABASE_URL`의 포트와 DB 이름은 `POSTGRES_PORT`, `POSTGRES_DB`와 같아야 합니다.

## 이미 떠 있는지 확인

```bash
docker ps --format '{{.Names}} {{.Ports}}' | grep oss-hub-guide
lsof -nP -iTCP:3310 -iTCP:4310 -sTCP:LISTEN
```

떠 있으면 다시 띄우지 않습니다. 캡처 에이전트가 쓰는 중에 재시작하면 세션과 데이터가 사라집니다.

## 끌 때

```bash
docker compose -p oss-hub-guide -f compose.dev.yml down -v
```

백엔드와 프런트 프로세스를 먼저 멈춥니다(`lsof`로 PID 확인 후 종료). `down -v`는 볼륨까지 지우므로 합성 데이터가 사라집니다. 다시 찍을 일이 남았으면 `-v` 없이 `down`만 쓰세요.

## 업데이트 때

화면이 바뀐 뒤 다시 찍을 때는 최신 main을 받은 상태에서 이 스택을 새로 띄웁니다. 마이그레이션이 늘었을 수 있으므로 3단계를 건너뛰지 않습니다. 시드나 준비 SQL이 새 스키마와 맞지 않으면 준비 SQL부터 고칩니다.

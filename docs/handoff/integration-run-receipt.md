# 실 Postgres 통합 실행 영수증 — 기여 추적 재설계

> 이 문서는 **재현 절차와 결과**를 남긴다. CI에 이 실행을 담는 job이 없어서,
> 근거가 세션 자기보고로만 남는 상태를 피하려고 저장소에 기록한다.
> 학생 식별자·저장소 이름·자격증명은 담지 않는다(`AGENTS.md` §6).

## 왜 필요했나

이 변경은 수집 writer와 읽기 경로를 함께 바꾼다. 단위 스펙은 Prisma를 mock하므로
**집합 SQL이 실제로 무엇을 넣는지 볼 수 없다.** 실제로 이 실행이 결함 두 개를 잡았다.

1. `AT TIME ZONE 'Asia/Seoul'`을 `timestamp WITHOUT time zone`에 바로 걸어
   저장값을 서울시각으로 **해석**하던 것 — KST 자정을 사이에 둔 두 커밋이 같은 날로 뭉쳤다
2. 드롭 단언이 분리 브랜치와 어긋나 baseline에서 실패하던 것

## 실행 환경

로컬에 Docker가 없어 **프로덕션 호스트의 Docker**를 빌려 격리 인스턴스를 띄웠다.
운영 DB는 건드리지 않는다 — 별도 컨테이너·별도 네트워크이며 실행 후 삭제한다.

| 항목 | 값 |
| --- | --- |
| 대상 commit | `60509615b037613ecbd5ae91ed9131a6fbf08bd8` |
| DB | `postgres:17-alpine` (격리 컨테이너, 운영과 분리) |
| 런타임 | `node:24-alpine`, pnpm 11 |
| 접속 | Tailscale SSH (`docs/deploy/server-runbook.md` M1) |

## 재현

```sh
# 격리 postgres 기동 → 브랜치 clone → 의존성 설치 → 마이그레이션 → 통합 스펙
docker run -d --name <pg> --network <net> \
  -e POSTGRES_USER=it -e POSTGRES_PASSWORD=it -e POSTGRES_DB=oss_hub_test \
  postgres:17-alpine

docker run --rm --network "container:<pg>" -v <repo>:/w -w /w \
  -e DATABASE_URL="postgresql://it:it@127.0.0.1:5432/oss_hub_test?schema=public" \
  -e OSS_HUB_INTEGRATION_RUNNER="oss-hub-isolated-integration-v1" \
  node:24-alpine sh -c 'pnpm install --frozen-lockfile && cd apps/backend \
    && npx prisma migrate deploy && npx jest --runInBand <specs>'
```

`DATABASE_URL`의 host가 `127.0.0.1`이어야 하고 sentinel이 맞아야 한다 —
`test/integration-database.guard.ts`가 운영 DB 오염을 fail-closed로 막는다.

## 마이그레이션

- `20260809000000_add_milestone_document_review_history`
- `20260809010000_add_milestone_document_submission_revision`
- `20260809120000_add_github_repository_queue`
- `20260809130000_add_contribution`

전체 42개가 clean DB에 적용됐다.

## 결과

- PASS src/github/collection-sync.service.100-repositories.integration.spec.ts (14.72 s)
- PASS src/github/collection-cutover-rollback.integration.spec.ts
- PASS src/github/contribution-recompute.integration.spec.ts
- PASS prisma/collection-incremental-migration.integration.spec.ts
- PASS src/github/collection-reconciliation.integration.spec.ts

**Test Suites: 5 passed, 5 total / Tests:       22 passed, 22 total**

## 알려진 제약

- `origin/main`도 clean DB에서 `accountStatus` 컬럼이 만들어지지 않아 다수 통합 스펙이 red다.
  main에서 직접 확인했으므로 이 변경과 무관하며 별건이다.
- 이 실행은 위 5개 스위트만 대상이다. 전체 통합 스위트를 통과했다는 뜻이 아니다.

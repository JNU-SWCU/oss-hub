# 시드 데이터 (#110)

역할별·상태별 테스트 시나리오를 결정적(deterministic)으로 만드는 시드다. 모든 식별자·이름·URL은
합성값이며, 실제 GitHub 계정·저장소·개인정보를 담지 않는다.

## 실행

```bash
# 기본값(profile=auth, 안전한 최소 시드)
pnpm --filter backend prisma db seed

# profile 지정 — env
SEED_PROFILE=intake pnpm --filter backend prisma db seed

# profile 지정 — CLI 인자
pnpm --filter backend prisma db seed -- --profile milestones
```

profile: `auth` (기본값) · `intake` · `milestones` · `repositories` · `all`.

- `prisma migrate reset`/`migrate dev`는 이 시드 훅을 자동 실행한다(기본값 `auth`만 돈다 — 안전한 최소).
- `prisma migrate deploy`(예: `scripts/run-backend-integration.sh`)는 자동 시드를 실행하지 않는다.
- `NODE_ENV=production`에서는 실행을 거부한다.
- 같은 profile을 여러 번 실행해도 안전하다 — 모든 row는 결정적 id(`seed:...`)로 upsert되어
  행 수가 늘지 않는다(멱등). `apps/backend/prisma/seed.integration.spec.ts`가 이 성질을 검증한다.

## 시나리오 카탈로그

시나리오 id ↔ 실제 레코드 매핑은 각 파일의 export를 참고한다.

- `auth` (9) — `seeds/auth.ts`의 `AUTH_SCENARIOS`: `consent-required`, `user-role-unselected`,
  `student-confirmed`, `staff-pending`, `staff-pending-second`, `staff-rejected`,
  `staff-approved`, `staff-revoked`, `admin-confirmed`.
  `staff-revoked`는 역할을 `STAFF`로 보존한 `DEACTIVATED` 계정이다.
- `intake` (15) — `seeds/intake.ts`: `empty-programs`, `program-seven-templates`,
  `program-overdue`, `program-with-applications`, `program-no-repository`, `empty-applications`,
  `application-personal`, `application-pending`, `application-approved`, `application-rejected`,
  `application-validation-error`(fixture 전용, DB에 심지 않음 — `APPLICATION_VALIDATION_ERROR_FIXTURE`),
  `team-empty`, `team-full`, `application-team`, `team-locked`.
- `milestones` (7) — `seeds/milestones.ts`의 `MILESTONE_SCENARIOS`: `milestones-upcoming`,
  `milestones-overdue`, `milestone-with-submission`, `submission-existing`,
  `submission-approved`, `submission-changes-requested`, `submission-rejected`.
- `repositories` (5) — `seeds/repositories.ts`: `repo-job-pending`, `repo-job-succeeded`,
  `repo-job-failed-retryable`, `repository-ready`, `repository-public`.

`intake`/`milestones`/`repositories` 각 profile은 서로 참조하지 않고 자체 Program·User
backbone을 만든다 — 빈 DB에서 어떤 profile을 단독 실행해도 성공한다.

## 알려진 제약

- `Application.answers`/`SubmissionRevision.content`는 #118(서버 고정 template field
  registry)이 아직 병합되지 않아 `{ seedPlaceholder: true, scenarioId }` 형태의 placeholder만
  담는다. #118 병합 후 registry의 유효 예시로 교체가 필요하다.
- admin 계정 승격(로그인 시 ADMIN role 부여)은 이 시드가 아니라 #109
  `src/auth/admin-bootstrap.ts`가 소유한다 — 중복 구현하지 않는다.

## 안전한 재실행

로컬 개발 DB를 초기화하려면 `pnpm db:reset`(=`prisma migrate reset --force`)을 쓴다. 이 명령은
**공유 개발 DB(`localhost:5432/oss_hub`)를 대상**으로 하므로, 다른 사람과 공유 중인 DB에서는
실행 전에 반드시 확인한다. CI/통합테스트는 `scripts/run-backend-integration.sh`가 매번 새로
띄우는 격리된 임시 컨테이너만 사용하며 공유 DB를 건드리지 않는다.

## 실제 계정 ↔ 역할 매핑

이 시드는 합성 계정만 만든다. 실제 GitHub 계정을 특정 역할(STAFF/ADMIN)로 테스트하려면 로컬
전용 `AUTH_TEST_ROLE_MAP` 환경변수(Issue #65, `src/auth/test-role-map.ts`)를 쓴다 — 값은
이 문서에 적지 않는다.

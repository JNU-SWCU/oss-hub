# 시드 데이터 (#110)

역할별·상태별 테스트 시나리오를 결정적(deterministic)으로 만드는 시드다.
기본 profile의 모든 식별자·이름·URL은 합성값이며, `oss-hub` profile의 계정 값은 운영자가 비공개 환경 변수로만 주입하고 tracked file이나 로그에 남기지 않는다.

## 실행

```bash
# 기본값(profile=auth, 안전한 최소 시드)
pnpm --filter backend prisma db seed

# profile 지정 — env
SEED_PROFILE=intake pnpm --filter backend prisma db seed

# profile 지정 — CLI 인자
pnpm --filter backend prisma db seed -- --profile milestones

# oss-hub profile — 명시적 비운영 환경, 확인값, 정확히 네 개의 ADMIN 항목이 필요
NODE_ENV=<development|test|staging|preview> OSS_HUB_SEED_CONFIRMATION=NON_PRODUCTION OSS_HUB_TEAM_ACCOUNTS='<github-id-1>:<github-login-1>:ADMIN,<github-id-2>:<github-login-2>:ADMIN,<github-id-3>:<github-login-3>:ADMIN,<github-id-4>:<github-login-4>:ADMIN' pnpm --filter backend db:seed -- --profile oss-hub
```

profile: `auth` (기본값) · `intake` · `milestones` · `repositories` · `oss-hub` · `all`.

- `prisma migrate reset`/`migrate dev`는 이 시드 훅을 자동 실행한다(기본값 `auth`만 돈다 — 안전한 최소).
- `prisma migrate deploy`(예: `scripts/run-backend-integration.sh`)는 자동 시드를 실행하지 않는다.
- `NODE_ENV=production`에서는 실행을 거부한다.
- `oss-hub`는 `development`·`test`·`staging`·`preview` 중 하나를 `NODE_ENV`에 명시하고 `OSS_HUB_SEED_CONFIRMATION=NON_PRODUCTION`을 함께 설정해야만 실행한다.
- 같은 profile을 여러 번 실행해도 안전하다 — 모든 row는 결정적 id(`seed:...`)로 upsert되어
  행 수가 늘지 않는다(멱등). `apps/backend/prisma/seed.integration.spec.ts`가 이 성질을 검증한다.

## 시나리오 카탈로그

시나리오 id ↔ 실제 레코드 매핑은 각 파일의 export를 참고한다.

- `auth` (10) — `seeds/auth.ts`의 `AUTH_SCENARIOS`: `consent-required`, `user-role-unselected`,
  `profile-complete`, `student-confirmed`, `staff-pending`, `staff-pending-second`, `staff-rejected`,
  `staff-approved`, `staff-revoked`, `admin-confirmed`.
  `user-role-unselected`는 동의 완료·프로필 미입력, `profile-complete`는 동의 완료·프로필 입력 완료 상태다.
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
- `oss-hub` — 기존 `auth` 합성 계정과 함께 `OSS_HUB_TEAM_ACCOUNTS`의 네 계정을 `ADMIN`으로 upsert하고,
  결정적 ID의 Program 1개·Team 1개·TeamMember 4개·Application 1개(팀 신청)를 만든다.
  변수는 쉼표로 구분한 `githubId:login:ADMIN` 네 항목만 허용하며 누락·형식 오류·중복 ID 또는 login·`ADMIN` 이외 역할을 모두 거부한다.
  오류와 실행 로그에는 변수 원문을 출력하지 않는다.
  트래킹 화면을 실데이터로 채우기 위해 다음도 함께 만든다:
  - Milestone 7개로 팀 Notion "📅 Schedule" DB의 실제 프로젝트 일정을 그대로 표현한다(고정
    ISO 날짜, Asia/Seoul 자정 기준 — `offsetDays` 상대 날짜가 아니다) — `AWS Staging`
    (2026-08-08) → `Intake 기능 동결`(2026-08-08) → `Intake Gate`(2026-08-15) → `구현 마감`
    (2026-08-21) → `Full-loop Dry-run`(2026-08-24) → `Full-loop Live Beta`(마감 2026-08-31,
    실사용 검증은 2026-08-27~29 — 스키마가 기간 필드를 지원하지 않아 `dueAt`은 검증 종료일로
    두고 시작일은 `instructions`에 남긴다) → `Release Complete`(2026-08-31).
  - Submission — `AWS Staging`은 팀장이 staging 배포 릴리즈 링크를 제출하고 합성 STAFF 계정
    (`auth` profile의 `staff-approved`)이 승인 리뷰를 남긴 상태, `Intake 기능 동결`은 다른
    팀원이 기능 동결 요약을 제출하고 아직 리뷰 대기 중인 상태다. 나머지 5개는 마감 전이라
    제출이 없다.
  - 마일스톤 마이그레이션 — 마일스톤 이름이 바뀌면(예: 이전 4개 arc `계획서 제출`/`중간 점검`/
    `기능 시연`/`최종 발표` → 현재 7개) 결정적 seedId의 slug도 함께 바뀐다. 재실행 시 새 slug
    집합에 없는 이전 마일스톤은 Review → SubmissionRevision → Submission → Milestone 순으로
    지워 정리한다(세 관계 모두 `onDelete` 미지정이라 기본값인 RESTRICT가 걸려 있어 자식부터
    지워야 한다) — 이미 배포된 DB에 구버전 마일스톤이 남아 있어도 다음 재시딩에서 자동으로
    새 구성으로 수렴하고 orphan을 남기지 않는다. 단 `SubmissionFile.milestoneId`처럼 seed
    밖에서 생긴 실사용 참조가 그 마일스톤에 남아 있으면 삭제가 의도적으로 FK 위반으로 실패한다
    — 이 경우 시드가 조용히 넘어가지 않고, 운영자가 직접 그 데이터를 확인해야 한다는 신호다.
  - Repository 1개 — 실제 공개 저장소 `github.com/JNU-SWCU/oss-hub`를 팀 신청에 연결해 공개
    완료(`PUBLIC`) 상태로 추적하고, 짝이 되는 RepositoryProvisionJob은 `SUCCEEDED`다. `githubRepositoryId`는
    GitHub API로 확인한 이 저장소의 실제 numeric id(`1297138137`, public 정보)를 그대로 쓴다.

`intake`/`milestones`/`repositories` 각 profile은 서로 참조하지 않고 자체 Program·User
backbone을 만든다 — 빈 DB에서 어떤 profile을 단독 실행해도 성공한다.

## 알려진 제약

- `Application.answers`/`SubmissionRevision.content`는 #118(서버 고정 template field
  registry)이 아직 병합되지 않아 `{ seedPlaceholder: true, scenarioId }` 형태의 placeholder만
  담는다. #118 병합 후 registry의 유효 예시로 교체가 필요하다.
- 로그인 시 초기 역할 부여는 이 시드가 아니라 `src/auth/auth.repository.ts`의 `AUTH_INITIAL_ROLES` 설정이 소유한다 — 중복 구현하지 않는다.

## 안전한 재실행

로컬 개발 DB를 초기화하려면 `pnpm db:reset`(=`prisma migrate reset --force`)을 쓴다. 이 명령은
**공유 개발 DB(`localhost:5432/oss_hub`)를 대상**으로 하므로, 다른 사람과 공유 중인 DB에서는
실행 전에 반드시 확인한다. CI/통합테스트는 `scripts/run-backend-integration.sh`가 매번 새로
띄우는 격리된 임시 컨테이너만 사용하며 공유 DB를 건드리지 않는다.

## 실제 계정 ↔ 역할 매핑

`oss-hub` profile 외에서 실제 GitHub 계정을 특정 역할(STAFF/ADMIN)로 테스트하려면 [온보딩의 역할별 테스트 계정 로그인 절](../../../docs/onboarding.md#역할별-테스트-계정-로그인)을 따라 `AUTH_INITIAL_ROLES`를 설정한다 — 값은 이 문서에 적지 않는다.

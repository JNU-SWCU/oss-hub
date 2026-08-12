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
# 각 항목은 githubId:login:ADMIN[:displayName] — displayName은 선택이며 넣으면 그 계정의
# User.name까지 채워 로그인 시 온보딩 화면으로 되돌아가지 않는다.
NODE_ENV=<development|test|staging|preview> OSS_HUB_SEED_CONFIRMATION=NON_PRODUCTION OSS_HUB_TEAM_ACCOUNTS='<github-id-1>:<github-login-1>:ADMIN:<display-name-1>,<github-id-2>:<github-login-2>:ADMIN:<display-name-2>,<github-id-3>:<github-login-3>:ADMIN:<display-name-3>,<github-id-4>:<github-login-4>:ADMIN:<display-name-4>' pnpm --filter backend db:seed -- --profile oss-hub

# demo profile — 비운영 환경(기본값 NODE_ENV). 사업단 톤의 합성 시연 데이터(프로그램·학생·팀·게시판)를 만든다.
pnpm --filter backend prisma db seed -- --profile demo

# demo profile — production 실행(예외). 소유자가 명시적으로 승인한 플랜에 기록된 건만 허용된다
# (아래 "production 실행 예외" 절 참조). 이 플래그 없이는 다른 모든 profile과 동일하게
# production에서 거부된다.
NODE_ENV=production SEED_DEMO_ALLOW_PRODUCTION=1 pnpm --filter backend prisma db seed -- --profile demo

# demo profile teardown — 이 profile이 만든 seed:demo:* 행 전부를 의존성 순서로 일괄
# 삭제한다(qa-econovation-batch TODO 15). 비운영 환경은 시드와 동일한 NODE_ENV 게이트만
# 통과하면 된다.
pnpm --filter backend prisma db seed -- --profile demo --teardown

# demo profile teardown — production 실행(예외). 시드와 동일한 SEED_DEMO_ALLOW_PRODUCTION=1
# 게이트를 통과해야 한다 — 새 시드 예외를 추가하지 않는다.
NODE_ENV=production SEED_DEMO_ALLOW_PRODUCTION=1 pnpm --filter backend prisma db seed -- --profile demo --teardown
```

profile: `auth` (기본값) · `intake` · `milestones` · `repositories` · `program-overview` · `oss-hub` · `demo` · `all`.

- `prisma migrate reset`/`migrate dev`는 이 시드 훅을 자동 실행한다(기본값 `auth`만 돈다 — 안전한 최소).
- `prisma migrate deploy`(예: `scripts/run-backend-integration.sh`)는 자동 시드를 실행하지 않는다.
- `NODE_ENV=production`에서는 실행을 거부한다.

  **production 실행 예외(`demo` profile 한정)**: `demo` profile은 소유자(@GoBeromsu)가
  명시적으로 승인한 경우에만(qa-econovation-batch 플랜 TODO 11) `SEED_DEMO_ALLOW_PRODUCTION=1`을
  함께 설정해 production에서도 실행할 수 있다(`assertSeedAllowed`, `seeds/helpers.ts`). 플래그가
  없거나 `1`이 아니면 다른 profile과 동일하게 거부된다. 이 예외는 `demo` 하나뿐이며, 새로운
  예외를 추가하려면 별도 소유자 승인과 플랜 문서화가 필요하다.
- `oss-hub`는 `development`·`test`·`staging`·`preview` 중 하나를 `NODE_ENV`에 명시하고 `OSS_HUB_SEED_CONFIRMATION=NON_PRODUCTION`을 함께 설정해야만 실행한다.
- `demo`는 `oss-hub`와 마찬가지로 `all`에 포함되지 않는다 — `--profile demo`를 명시적으로 고를 때만 실행된다.
- 같은 profile을 여러 번 실행해도 안전하다 — 모든 row는 결정적 id(`seed:...`)로 upsert되어
  행 수가 늘지 않는다(멱등). `apps/backend/prisma/seed.integration.spec.ts`가 이 성질을 검증한다.

## 시나리오 카탈로그

시나리오 id ↔ 실제 레코드 매핑은 각 파일의 export를 참고한다.

- `auth` (12) — `seeds/auth.ts`의 `AUTH_SCENARIOS`: `consent-required`, `user-role-unselected`,
  `profile-complete`, `student-confirmed`, `staff-pending`, `staff-pending-second`, `staff-rejected`,
  `staff-approved`, `staff-revocable`, `staff-revoked`, `admin-confirmed`, `admin-second`.
  `user-role-unselected`는 동의 완료·프로필 미입력, `profile-complete`는 동의 완료·프로필 입력 완료 상태다.
  `staff-revoked`는 역할을 `STAFF`로 보존한 `DEACTIVATED` 계정이다.
  `staff-revocable`은 그와 달리 `ACTIVE`인 승인 완료 교직원이다 — 관리자가 화면에서 **회수를 누를 대상**이며,
  `DEACTIVATED` 계정은 로그인 자체가 401이라 회수 직후 화면을 만들 수 없어 따로 둔다.
  `admin-confirmed`·`admin-second`는 둘 다 이름이 채워진 프로필 완료 `ADMIN`이다 —
  이름이 비면 관리자 화면 진입이 온보딩으로 되돌려지고, 두 계정이 있어야 결정 이력의
  `decidedBy`로 "다른 관리자가 먼저 처리했다"를 화면에서 구분할 수 있다.
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
  `repository-public`은 `visibility: PUBLIC`이지만 `publishedAt: null`이라 공개 아카이브
  (`GET /api/v1/projects`)의 `publishedAt: { not: null }` 필터에 걸려 노출되지 않는다 — 합성
  fixture URL을 실제 저장소처럼 보이게 만들지 않기 위한 의도된 설계다.
- `program-overview` — `seeds/program-overview.ts`: 마일스톤별 서류 항목(`MilestoneDocument`/
  `MilestoneDocumentTemplateFile`/`MilestoneDocumentSubmission`)·프로그램 게시판(`BoardPost`/
  `BoardComment`)·검색 초대형 팀 초대(`TeamInvitation`) 전용 합성 backbone이다. 다른 profile을
  참조하지 않는 자체 Program(`CAPSTONE`)·팀 1개(팀장·팀원 각 1명)·초대 대상 1명으로, 마일스톤
  7개(`#1 수강 신청 · 팀 등록` … `#7 최종 발표 · 시연`)를 만들고 `#3 프로젝트 계획서 제출`·
  `#4 1차 중간 산출물 제출`에 각각 서류 항목 3종(필수 2 · 선택 1)을 매단다. `#3`의 서류 두 건은
  제출 완료 예시로 `SubmissionFile`까지 채우고, 나머지는 프로토타입 스펙대로 미제출로 남긴다.
  게시글 3건(공지 2 · 질문 1, 질문에는 답글)과 `PENDING` 팀 초대 1건도 함께 만든다. 모든 식별자·
  이름은 합성값이다.
- `oss-hub` — 기존 `auth` 합성 계정과 함께 `OSS_HUB_TEAM_ACCOUNTS`의 네 계정을 `ADMIN`으로 upsert하고,
  결정적 ID의 Program 2개(oss-hub 본 프로그램·oss-hub-practice 실습 프로그램)·Team 2개·
  TeamMember 8개(각 Program에 같은 네 명)·Application 2개(각 Program당 팀 신청 1건)를 만든다.
  변수는 쉼표로 구분한 `githubId:login:ADMIN[:displayName]` 네 항목만 허용하며 누락·형식 오류·중복 ID 또는
  login·`ADMIN` 이외 역할·(있다면) 유효하지 않은 displayName을 모두 거부한다.
  오류와 실행 로그에는 변수 원문을 출력하지 않는다.
  네 계정은 실제 온보딩 완료 사용자와 같은 DB 상태로 만들어진다 — `role=ADMIN`, `accountStatus=ACTIVE`,
  Consent 완료(`upsertConsent`). `displayName`이 있으면 `User.name`도 그 값으로 채워 로그인 시
  프로필 온보딩 화면으로 되돌아가지 않는다(`isCompleteProfileFields`/`isProfileComplete` 계약과 동일 —
  ADMIN도 이름은 항상 필수다). `displayName`이 없으면 이름은 비워 두며, 이 경우 그 계정은 여전히
  온보딩 미완료로 남는다(정책을 완화하지 않는다).
  트래킹 화면을 실데이터로 채우기 위해 다음도 함께 만든다:
  - Milestone 7개로 팀 Notion "📅 Schedule" DB의 실제 프로젝트 일정을 그대로 표현한다(고정
    ISO 날짜, Asia/Seoul 자정 기준 — `offsetDays` 상대 날짜가 아니다). 각 마일스톤의 시작과
    마감은 각각 `Milestone.startAt`·`Milestone.dueAt`에 저장한다 — `AWS Staging`
    (2026-08-08) → `Intake 기능 동결`(2026-08-08) → `Intake Gate`(2026-08-15) → `구현 마감`
    (2026-08-21) → `Full-loop Dry-run`(2026-08-24) → `Full-loop Live Beta`(시작 2026-08-27,
    마감 2026-08-31) → `Release Complete`(2026-08-31). 별도 시작일이 문서화되지 않은 고정 일정은
    프로그램 시작일을 `startAt`으로 사용한다.
  - Submission — `AWS Staging`은 팀장이 staging 배포 결과를 TEXT로 제출하고 합성 STAFF 계정
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
  - GithubRepository 1개 — 실제 공개 저장소 `github.com/JNU-SWCU/oss-hub`를 팀 신청에 연결해
    공개 완료(`visibility: PUBLIC`) 상태로 추적한다(`applicationId`·`programId`가 이 행에 직접
    실려 프로비저닝 신청과 연결을 증명한다, `#617` 단계 D). 짝이 되는 RepositoryProvisionJob은
    `SUCCEEDED`다. `githubRepositoryId`는 GitHub API로 확인한 이 저장소의 실제 numeric
    id(`1297138137`, public 정보)를 그대로 쓴다.
  - GithubRepository 2개째(`oss-hub-practice`) — `github.com/JNU-SWCU/oss-hub-practice`(학생
    fork/배포 퀘스트 실습용 저장소)를 별도 Program·Team·Application·GithubRepository 체인으로
    공개 완료(`visibility: PUBLIC`) 상태로 추적한다. 기존 oss-hub Program·Team을 재사용하지 않는
    이유는 `Application_programId_teamId_team_key` partial unique index(같은 팀은 같은 Program에
    신청을 한 건만 낼 수 있다) 때문이다 — 이 제약은 `schema.prisma`에는 표현되지 않고
    마이그레이션 SQL에만 있어 정적으로는 드러나지 않는다. 그래서 같은 네 명의 ADMIN 계정을
    팀원으로 하는 새 Program(`오픈소스 실습 배포 퀘스트`)·Team(`oss-hub-practice`)을 만들고
    그 아래 Application·GithubRepository·RepositoryProvisionJob을 매단다. `githubRepositoryId`는
    GitHub API로 확인한 실제 numeric id(`1296567792`, public 정보)를 그대로 쓴다. 아카이브
    상세 화면의 지표·기여자는 별도 시드 데이터 없이 `githubRepositoryId` 기준 collection
    파이프라인 조인으로 자동 채워진다(`program-activity.service.ts`/
    `public-projects.repository.ts`의 `canonicalByRepository` 패턴 — Program 정체성과
    무관하게 GithubRepository 행 기준으로 조인한다).

- `demo` — `seeds/demo.ts`: 내일 시연을 위한 "사업단이 실제 운영하는 느낌"의 합성 데이터다. 다른
  profile을 참조하지 않고 자체 Program·User·Team backbone을 만든다. 이 profile은 GithubRepository·
  Contribution 등 수집/랭킹 테이블을 **절대** 만들지 않는다(`prisma/AGENTS.md` 시드 규칙 #5) —
  Econovation 공개 저장소 수집 등록은 별도의 실제 ADMIN discovery/enrollment 경로 + 실제 sweep으로만
  이루어진다.
  - 프로그램 4개 — 전남대 SW중심대학사업단이 공개 운영하는 실제 프로그램 유형(하계 SW인턴십
    연계 → `CORPORATE_INTERNSHIP`, 오픈소스 SW개발자 대회(에코노베이션 연계) → `OSS_CONTEST`,
    신입생 SW역량 강화 → `SW_VALUE_SPREAD`, 소중마일리지 연계 비교과 → `BASIC`)을 모델로 한
    이름·설명이지만, 일정은 모두 `offsetDays` 상대값으로 만든 합성값이다(실제 공지 일정
    미복사 — `prisma/AGENTS.md` 시드 규칙 #3·#4). 각 프로그램 설명과 마일스톤 안내는 "모집
    배경/지원 대상/운영 방식/문의 안내" 구성으로 사업단 공개 페이지(sojoong.kr)의 톤·용어를
    참고해 계획서처럼 읽히도록 재작성됐다(TODO 15) — 본문을 그대로 옮기지 않고, 문의 안내의
    담당자 이메일도 합성(`.invalid`)이다.
  - 합성 한국식 학생 14명(예: 김도윤·이서준·박하은 등, 실존 인물 아님)이 네 프로그램에 나눠
    배치된다. 이메일은 모두 `@demo.invalid`(RFC 2606 예약 도메인)만 쓴다. 합성 STAFF 1명
    (`합성 사업단 담당자`)이 네 프로그램의 공통 게시글 작성자이자 리뷰어다.
  - 하계 SW인턴십·신입생 캠프·소중마일리지 세 프로그램은 기존과 동일하게 팀 1개·승인된 지원서
    1건·마일스톤 1개를 만든다.
  - **다팀 그래프(TODO 15)**: '2026 오픈소스 SW개발자 대회(에코노베이션 연계)' 프로그램은
    참가팀 5개(2~4명씩, 서로 겹치지 않는 학생)가 각각 승인된 지원서 1건을 갖는다. 마일스톤은
    중간 데모데이 발표자료 제출(FILE)과 최종 발표(TEXT) 2개로, 팀마다 제출 상태를 제출됨
    (SUBMITTED)·보완 필요(CHANGES_REQUESTED)·승인(APPROVED)으로 섞어 '여러 팀이 참여해
    기록이 쌓이는 모습'을 화면에서 보여준다. 보완 필요·승인 건은 Review도 함께 만든다.
  - 프로그램당 게시판 1~2건(공지 또는 질문, 댓글 1~2개 포함)로 시연 화면을 채운다.
  - 모든 id는 결정적 `seed:demo:...`로 upsert된다(멱등). GithubRepository·Contribution 행은
    이 profile이 종료된 뒤에도 항상 0건이어야 한다(`seed.integration.spec.ts`가 검증).
  - **teardown(TODO 15)**: `--teardown` 플래그로 이 profile이 만든 `seed:demo:*` 행 전부를
    의존성 순서(SubmissionFile→Review→SubmissionRevision→Submission→BoardComment→BoardPost→
    TeamMember→Milestone→Application→Team→Program→Consent→UserProfile→User)로 일괄
    삭제한다. 모든 삭제는 `startsWith: 'seed:demo:'` 필터를 강제해 `seed:demo:` 접두사가
    아닌 행은 절대 건드리지 않는다. production에서도 시드와 동일한
    `SEED_DEMO_ALLOW_PRODUCTION=1` 게이트를 통과해야 한다(`assertSeedAllowed`).

`intake`/`milestones`/`repositories`/`program-overview`/`demo` 각 profile은 서로 참조하지 않고 자체
Program·User backbone을 만든다 — 빈 DB에서 어떤 profile을 단독 실행해도 성공한다.

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

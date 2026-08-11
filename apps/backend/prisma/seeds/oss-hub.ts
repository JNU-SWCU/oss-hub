import {
  AccountStatus,
  ApplicationStatus,
  MilestoneSubmissionType,
  ProgramCategory,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  ReviewDecision,
  Role,
  SubmissionStatus,
  User,
} from '@prisma/client';
import { computeJoinCodeDigest } from '../../src/common/join-code-digest';
import { AUTH_SCENARIOS } from './auth';
import {
  offsetDays,
  OssHubTeamAccount,
  prisma,
  seedId,
  SeedStats,
  upsertConsent,
  upsertTracked,
} from './helpers';

const PROGRAM_ID = seedId('oss-hub', 'program');
const TEAM_ID = seedId('oss-hub', 'team');
const APPLICATION_ID = seedId('oss-hub', 'application');
const REPOSITORY_ID = seedId('oss-hub', 'repository');
const PROVISION_JOB_ID = seedId('oss-hub', 'provision-job');
/**
 * JNU-SWCU/oss-hub 플랫폼 자체의 공개 저장소 — 실제 nameWithOwner 참조는 허용된다
 * (`AGENTS.md` antipattern #2: 실존 대상은 실제 공개 메타데이터를 그대로 쓴다). #617 단계 D
 * 이후 GithubRepository는 name/url 컬럼이 없고 nameWithOwner에서 파생하므로
 * (`repository-identity.ts`), 여기서도 url 대신 nameWithOwner를 저장한다.
 */
const OSS_HUB_REPOSITORY_NAME_WITH_OWNER = 'JNU-SWCU/oss-hub';
const PROGRAM_NAME = '오픈소스 플랫폼 구축';
const PROGRAM_ORGANIZER = '오픈소스 SW 개발 사업단';
/** JNU-SWCU/oss-hub 공개 저장소의 실제 GitHub numeric id (GitHub REST API로 확인, public 정보). */
const OSS_HUB_GITHUB_REPOSITORY_ID = 1297138137n;
const PROGRAM_DESCRIPTION =
  '오픈소스 SW 개발 사업단이 주관하는 오픈소스 플랫폼 구축 프로그램. 참여 팀은 마일스톤별로 진행 상황과 산출물을 제출하고, GitHub 저장소를 통해 결과물을 공개한다. 공지 예시: [모집홍보] 2026 오픈소스 개발자대회 모집 안내 (https://sojoong.kr/notice/notice-board/?mod=document&uid=922); ｢모집홍보｣ 『LLMOps 파이프라인 개발』 교육 2026학년 2학기 자유학기(자유교과목) 신청 안내 (https://sojoong.kr/notice/notice-board/?mod=document&uid=939).';

// oss-hub-practice — 별도 Program·Team·Application·Repository 체인(#113: Repository는
// applicationId당 최대 한 건, #164: 같은 팀은 같은 Program에 신청을 한 건만 낼 수 있다 —
// `Application_programId_teamId_team_key` partial unique index, Prisma schema에는 표현되지
// 않고 마이그레이션 SQL이 원본이다. 그래서 기존 oss-hub Program·Team을 재사용할 수 없고,
// 같은 네 명의 ADMIN 계정으로 별도 Program·Team을 새로 만든다).
const PRACTICE_PROGRAM_ID = seedId('oss-hub-practice', 'program');
const PRACTICE_TEAM_ID = seedId('oss-hub-practice', 'team');
const PRACTICE_APPLICATION_ID = seedId('oss-hub-practice', 'application');
const PRACTICE_REPOSITORY_ID = seedId('oss-hub-practice', 'repository');
const PRACTICE_PROVISION_JOB_ID = seedId('oss-hub-practice', 'provision-job');
const PRACTICE_PROGRAM_NAME = '오픈소스 실습 배포 퀘스트';
/** JNU-SWCU/oss-hub-practice 학생 실습용 공개 저장소 — 실제 공개 URL 참조는 허용된다. */
const OSS_HUB_PRACTICE_REPOSITORY_URL =
  'https://github.com/JNU-SWCU/oss-hub-practice';
/**
 * #617 단계 D 이후 GithubRepository는 name/url 컬럼이 없고 nameWithOwner에서 파생하므로
 * (`repository-identity.ts`), 저장소 행 생성에는 url 대신 이 값을 쓴다. 위 URL 상수는 설명
 * 문구(`PRACTICE_PROGRAM_DESCRIPTION`)에서 계속 쓰인다.
 */
const OSS_HUB_PRACTICE_NAME_WITH_OWNER = 'JNU-SWCU/oss-hub-practice';
/** JNU-SWCU/oss-hub-practice 공개 저장소의 실제 GitHub numeric id (GitHub REST API로 확인, public 정보). */
const OSS_HUB_PRACTICE_GITHUB_REPOSITORY_ID = 1296567792n;
/** 실제 GitHub 저장소 생성일(2026-07-10, public 정보) — Asia/Seoul 자정 기준. */
const OSS_HUB_PRACTICE_CREATED_AT = kstMidnight('2026-07-10');
const OSS_HUB_PRACTICE_DESCRIPTION =
  'JNU OSS Hub practice repository for student fork and deployment quests (학생 fork/배포 퀘스트 실습용). 기본 브랜치는 main입니다.';
const PRACTICE_PROGRAM_DESCRIPTION = `학생이 ${OSS_HUB_PRACTICE_REPOSITORY_URL}를 fork하고 배포까지 완료하는 실습 퀘스트 프로그램입니다. ${OSS_HUB_PRACTICE_DESCRIPTION}`;

/**
 * Notion "📅 Schedule" DB의 실제 프로젝트 마일스톤 날짜를 그대로 반영하는 고정 UTC Date.
 * `isoDate`는 Asia/Seoul 자정 기준이다 — offsetDays(SEED_NOW 상대)를 쓰지 않는다.
 */
function kstMidnight(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+09:00`);
}

/**
 * 설정된 ADMIN 계정을 실제 온보딩 완료 사용자와 동일한 DB 상태로 만든다 — role=ADMIN,
 * accountStatus=ACTIVE, Consent 완료, (제공된 경우) name까지 채워 로그인 시 온보딩/동의
 * 화면으로 되돌아가지 않게 한다(`auth.repository.ts`의 `isProfileComplete` 계약과 동일).
 *
 * name은 `account.displayName`이 있을 때만 쓴다 — 없으면 생성 시 비워 두고, 갱신 시에도
 * 기존 값을 지우지 않는다(재로그인이 온보딩에서 확정한 이름을 덮어쓰지 않는다는
 * `auth.repository.ts`의 원칙과 같은 이유).
 */
async function upsertConfiguredUser(
  stats: SeedStats,
  account: OssHubTeamAccount,
): Promise<User> {
  const id = seedId('oss-hub', 'user', account.githubId.toString());
  const nameField =
    account.displayName !== undefined ? { name: account.displayName } : {};
  const user = await upsertTracked(
    stats,
    'User',
    () => prisma.user.findUnique({ where: { githubId: account.githubId } }),
    () =>
      prisma.user.upsert({
        where: { githubId: account.githubId },
        update: {
          nickname: account.login,
          role: Role.ADMIN,
          accountStatus: AccountStatus.ACTIVE,
          ...nameField,
        },
        create: {
          id,
          githubId: account.githubId,
          nickname: account.login,
          role: Role.ADMIN,
          accountStatus: AccountStatus.ACTIVE,
          ...nameField,
        },
      }),
  );
  await upsertConsent(stats, user.id);
  return user;
}

type OssHubMilestoneSeed = {
  readonly id: string;
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
  readonly instructions: string;
};

const PROGRAM_APPLICATION_START_AT = kstMidnight('2026-07-01');
const PROGRAM_APPLICATION_END_AT = kstMidnight('2026-08-01');
const PROGRAM_START_AT = kstMidnight('2026-08-02');
const PROGRAM_END_AT = kstMidnight('2026-09-01');

export async function seedOssHub(
  stats: SeedStats,
  accounts: readonly OssHubTeamAccount[],
): Promise<void> {
  const users: User[] = [];
  for (const account of accounts) {
    users.push(await upsertConfiguredUser(stats, account));
  }

  await upsertTracked(
    stats,
    'Program',
    () => prisma.program.findUnique({ where: { id: PROGRAM_ID } }),
    () =>
      prisma.program.upsert({
        where: { id: PROGRAM_ID },
        update: {
          name: PROGRAM_NAME,
          organizer: PROGRAM_ORGANIZER,
          category: ProgramCategory.OSS_CONTEST,
          applicationTemplateKey: ProgramCategory.OSS_CONTEST.toLowerCase(),
          applicationTemplateVersion: 1,
          applicationStartAt: PROGRAM_APPLICATION_START_AT,
          applicationEndAt: PROGRAM_APPLICATION_END_AT,
          startAt: PROGRAM_START_AT,
          endAt: PROGRAM_END_AT,
          teamMinSize: 4,
          teamMaxSize: 4,
          description: PROGRAM_DESCRIPTION,
          repositoryProvisioningEnabled: true,
          notifyOnDeadline: false,
        },
        create: {
          id: PROGRAM_ID,
          name: PROGRAM_NAME,
          organizer: PROGRAM_ORGANIZER,
          category: ProgramCategory.OSS_CONTEST,
          applicationTemplateKey: ProgramCategory.OSS_CONTEST.toLowerCase(),
          applicationTemplateVersion: 1,
          applicationStartAt: PROGRAM_APPLICATION_START_AT,
          applicationEndAt: PROGRAM_APPLICATION_END_AT,
          startAt: PROGRAM_START_AT,
          endAt: PROGRAM_END_AT,
          teamMinSize: 4,
          teamMaxSize: 4,
          description: PROGRAM_DESCRIPTION,
          repositoryProvisioningEnabled: true,
        },
      }),
  );

  await upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: TEAM_ID } }),
    () =>
      prisma.team.upsert({
        where: { id: TEAM_ID },
        update: {
          name: 'oss-hub',
          joinCodeDigest: computeJoinCodeDigest('SEED-OSS-HUB'),
          leaderId: users[0]!.id,
        },
        create: {
          id: TEAM_ID,
          programId: PROGRAM_ID,
          name: 'oss-hub',
          joinCodeDigest: computeJoinCodeDigest('SEED-OSS-HUB'),
          leaderId: users[0]!.id,
        },
      }),
  );

  // 팀의 프로그램 신청 — Submission·Repository·RepositoryProvisionJob이 모두 이
  // 하나의 Application에 매달린다(신청당 최대 한 건인 Repository/ProvisionJob 계약, #113).
  await upsertTracked(
    stats,
    'Application',
    () => prisma.application.findUnique({ where: { id: APPLICATION_ID } }),
    () =>
      prisma.application.upsert({
        where: { id: APPLICATION_ID },
        update: {
          status: ApplicationStatus.APPROVED,
        },
        create: {
          id: APPLICATION_ID,
          programId: PROGRAM_ID,
          applicantId: users[0]!.id,
          teamId: TEAM_ID,
          answers: {
            applicantName: 'oss-hub',
            title: 'oss-hub 오픈소스 트래킹 플랫폼 구축',
            summary:
              '전남대 오픈소스 플랫폼 구축 프로그램 추적 화면을 실데이터로 검증하기 위한 팀 신청 fixture입니다.',
          },
          applicationTemplateVersion: 1,
          status: ApplicationStatus.APPROVED,
          processedAt: offsetDays(-28),
        },
      }),
  );

  // 마일스톤 전체 arc: 팀 Notion "📅 Schedule" DB의 실제 프로젝트 일정 7건이다(고정 날짜,
  // Asia/Seoul 자정 기준). AWS Staging → Intake 기능 동결 → Intake Gate → 구현 마감 →
  // Full-loop Dry-run → Full-loop Live Beta → Release Complete.
  const milestones: readonly OssHubMilestoneSeed[] = [
    {
      id: seedId('oss-hub', 'milestone', 'aws-staging'),
      name: 'AWS Staging',
      startAt: PROGRAM_START_AT,
      dueAt: kstMidnight('2026-08-08'),
      submissionType: MilestoneSubmissionType.TEXT,
      instructions:
        '승인된 AWS 구조에 staging 환경을 배포하고 HTTPS·헬스체크·롤백 절차를 검증합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'intake-freeze'),
      name: 'Intake 기능 동결',
      startAt: PROGRAM_START_AT,
      dueAt: kstMidnight('2026-08-08'),
      submissionType: MilestoneSubmissionType.TEXT,
      instructions:
        '프로그램 조회·신청·팀 구성·저장소 흐름의 happy path와 failure path를 모두 통과시켜 기능을 동결합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'intake-gate'),
      name: 'Intake Gate',
      startAt: PROGRAM_START_AT,
      dueAt: kstMidnight('2026-08-15'),
      submissionType: MilestoneSubmissionType.TEXT,
      instructions: '실사용자 시나리오와 권한·오류·회귀 검증을 완료합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'implementation-deadline'),
      name: '구현 마감',
      startAt: PROGRAM_START_AT,
      dueAt: kstMidnight('2026-08-21'),
      submissionType: MilestoneSubmissionType.TEXT,
      instructions:
        'PRD·IA 필수 기능과 운영 표면의 구현 PR을 모두 검토(review) 이상 상태로 만듭니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'dry-run'),
      name: 'Full-loop Dry-run',
      startAt: PROGRAM_START_AT,
      dueAt: kstMidnight('2026-08-24'),
      submissionType: MilestoneSubmissionType.FILE,
      instructions:
        '신청 → 저장소 → 활동 수집 → 마일스톤 → 검토 → 공개로 이어지는 전체 흐름을 합성 데이터로 재현합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'live-beta'),
      name: 'Full-loop Live Beta',
      startAt: kstMidnight('2026-08-27'),
      dueAt: kstMidnight('2026-08-31'),
      submissionType: MilestoneSubmissionType.TEXT,
      instructions:
        '승인된 베타 범위에서 실사용 검증을 진행하고 차단 이슈를 기록합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'release-complete'),
      name: 'Release Complete',
      startAt: PROGRAM_START_AT,
      dueAt: kstMidnight('2026-08-31'),
      submissionType: MilestoneSubmissionType.TEXT,
      instructions:
        '릴리스 체크리스트·운영 문서·복구 연습·최종 QA를 모두 완료합니다.',
    },
  ] as const;
  // 과거 profile 실행이 남긴 다른 마일스톤 구성(예: 이전 4개 arc인 계획서 제출/중간 점검/
  // 기능 시연/최종 발표, 또는 kickoff 같은 실험용 이름)을 정리한다. 그 마일스톤에 Submission이
  // 남아 있으면 Milestone.submissions FK가 RESTRICT라 먼저 Review → SubmissionRevision →
  // Submission 순으로 지워야 삭제가 성공한다. SubmissionFile.milestoneId도 RESTRICT라 실사용
  // 업로드가 남아 있으면 이 삭제는 의도적으로 실패한다 — 그 경우 시드가 아니라 운영자가 직접
  // 처리해야 한다는 신호로 취급한다.
  const newMilestoneIds = milestones.map((milestone) => milestone.id);
  const staleMilestones = await prisma.milestone.findMany({
    where: { programId: PROGRAM_ID, id: { notIn: newMilestoneIds } },
    select: { id: true },
  });
  const staleMilestoneIds = staleMilestones.map((milestone) => milestone.id);
  if (staleMilestoneIds.length > 0) {
    await prisma.review.deleteMany({
      where: {
        submissionRevision: {
          submission: { milestoneId: { in: staleMilestoneIds } },
        },
      },
    });
    await prisma.submissionRevision.deleteMany({
      where: { submission: { milestoneId: { in: staleMilestoneIds } } },
    });
    await prisma.submission.deleteMany({
      where: { milestoneId: { in: staleMilestoneIds } },
    });
    await prisma.milestone.deleteMany({
      where: { id: { in: staleMilestoneIds } },
    });
  }
  for (const milestone of milestones) {
    await upsertTracked(
      stats,
      'Milestone',
      () => prisma.milestone.findUnique({ where: { id: milestone.id } }),
      () =>
        prisma.milestone.upsert({
          where: { id: milestone.id },
          update: {
            name: milestone.name,
            startAt: milestone.startAt,
            dueAt: milestone.dueAt,
            submissionType: milestone.submissionType,
            instructions: milestone.instructions,
          },
          create: {
            id: milestone.id,
            programId: PROGRAM_ID,
            name: milestone.name,
            startAt: milestone.startAt,
            dueAt: milestone.dueAt,
            submissionType: milestone.submissionType,
            instructions: milestone.instructions,
          },
        }),
    );
  }
  const [awsStagingMilestone, intakeFreezeMilestone] = milestones;

  const memberIds = accounts.map((account) =>
    seedId('oss-hub', 'team-member', account.githubId.toString()),
  );
  await prisma.teamMember.deleteMany({
    where: { teamId: TEAM_ID, id: { notIn: memberIds } },
  });
  for (const [index, user] of users.entries()) {
    const id = memberIds[index]!;
    await upsertTracked(
      stats,
      'TeamMember',
      () => prisma.teamMember.findUnique({ where: { id } }),
      () =>
        prisma.teamMember.upsert({
          where: { id },
          update: {
            teamId: TEAM_ID,
            programId: PROGRAM_ID,
            userId: user.id,
          },
          create: {
            id,
            teamId: TEAM_ID,
            programId: PROGRAM_ID,
            userId: user.id,
          },
        }),
    );
  }

  // aws-staging: 팀장이 staging 배포 결과를 제출하고 STAFF가 승인 리뷰를 남긴 상태.
  const awsStagingSubmissionId = seedId('oss-hub', 'submission', 'aws-staging');
  await upsertTracked(
    stats,
    'Submission',
    () =>
      prisma.submission.findUnique({ where: { id: awsStagingSubmissionId } }),
    () =>
      prisma.submission.upsert({
        where: { id: awsStagingSubmissionId },
        update: { status: SubmissionStatus.APPROVED, currentRevision: 1 },
        create: {
          id: awsStagingSubmissionId,
          milestoneId: awsStagingMilestone!.id,
          applicationId: APPLICATION_ID,
          status: SubmissionStatus.APPROVED,
          currentRevision: 1,
        },
      }),
  );
  const awsStagingRevisionId = seedId(
    'oss-hub',
    'submission',
    'aws-staging',
    'revision-1',
  );
  await upsertTracked(
    stats,
    'SubmissionRevision',
    () =>
      prisma.submissionRevision.findUnique({
        where: { id: awsStagingRevisionId },
      }),
    () =>
      prisma.submissionRevision.upsert({
        where: { id: awsStagingRevisionId },
        update: {},
        create: {
          id: awsStagingRevisionId,
          submissionId: awsStagingSubmissionId,
          revision: 1,
          submissionType: MilestoneSubmissionType.TEXT,
          content: {
            type: MilestoneSubmissionType.TEXT,
            text: 'staging 배포와 HTTPS·헬스체크·롤백 절차 검증을 완료했습니다 (seed fixture).',
          },
          submittedById: users[0]!.id,
        },
      }),
  );
  const awsStagingReviewId = seedId(
    'oss-hub',
    'submission',
    'aws-staging',
    'review',
  );
  await upsertTracked(
    stats,
    'Review',
    () => prisma.review.findUnique({ where: { id: awsStagingReviewId } }),
    () =>
      prisma.review.upsert({
        where: { id: awsStagingReviewId },
        update: {
          decision: ReviewDecision.APPROVED,
          comment:
            'staging 배포와 헬스체크·롤백 절차까지 확인했습니다. 통과 처리합니다 (seed fixture).',
        },
        create: {
          id: awsStagingReviewId,
          submissionRevisionId: awsStagingRevisionId,
          reviewerId: AUTH_SCENARIOS['staff-approved'],
          decision: ReviewDecision.APPROVED,
          comment:
            'staging 배포와 헬스체크·롤백 절차까지 확인했습니다. 통과 처리합니다 (seed fixture).',
        },
      }),
  );

  // intake-freeze: 다른 팀원이 기능 동결 요약을 제출했고 아직 리뷰 대기 중.
  const intakeFreezeSubmissionId = seedId(
    'oss-hub',
    'submission',
    'intake-freeze',
  );
  await upsertTracked(
    stats,
    'Submission',
    () =>
      prisma.submission.findUnique({
        where: { id: intakeFreezeSubmissionId },
      }),
    () =>
      prisma.submission.upsert({
        where: { id: intakeFreezeSubmissionId },
        update: { status: SubmissionStatus.SUBMITTED, currentRevision: 1 },
        create: {
          id: intakeFreezeSubmissionId,
          milestoneId: intakeFreezeMilestone!.id,
          applicationId: APPLICATION_ID,
          status: SubmissionStatus.SUBMITTED,
          currentRevision: 1,
        },
      }),
  );
  const intakeFreezeRevisionId = seedId(
    'oss-hub',
    'submission',
    'intake-freeze',
    'revision-1',
  );
  await upsertTracked(
    stats,
    'SubmissionRevision',
    () =>
      prisma.submissionRevision.findUnique({
        where: { id: intakeFreezeRevisionId },
      }),
    () =>
      prisma.submissionRevision.upsert({
        where: { id: intakeFreezeRevisionId },
        update: {},
        create: {
          id: intakeFreezeRevisionId,
          submissionId: intakeFreezeSubmissionId,
          revision: 1,
          submissionType: MilestoneSubmissionType.TEXT,
          content: {
            type: MilestoneSubmissionType.TEXT,
            text: '프로그램 조회·신청·팀 구성·저장소 흐름의 happy/failure 경로 테스트를 마치고 기능을 동결했습니다 (seed fixture).',
          },
          submittedById: (users[2] ?? users[0])!.id,
        },
      }),
  );

  // 저장소 추적 — 실제 공개 저장소(github.com/JNU-SWCU/oss-hub)를 연결·공개 완료 상태로 표현한다.
  await upsertTracked(
    stats,
    'GithubRepository',
    () => prisma.githubRepository.findUnique({ where: { id: REPOSITORY_ID } }),
    () =>
      prisma.githubRepository.upsert({
        where: { id: REPOSITORY_ID },
        update: {
          githubRepositoryId: OSS_HUB_GITHUB_REPOSITORY_ID,
          visibility: RepositoryVisibility.PUBLIC,
        },
        create: {
          id: REPOSITORY_ID,
          applicationId: APPLICATION_ID,
          programId: PROGRAM_ID,
          teamId: TEAM_ID,
          githubRepositoryId: OSS_HUB_GITHUB_REPOSITORY_ID,
          nameWithOwner: OSS_HUB_REPOSITORY_NAME_WITH_OWNER,
          source: RepositorySource.ORG_PROVISIONED,
          visibility: RepositoryVisibility.PUBLIC,
          publishedAt: offsetDays(-30),
        },
      }),
  );
  await upsertTracked(
    stats,
    'RepositoryProvisionJob',
    () =>
      prisma.repositoryProvisionJob.findUnique({
        where: { id: PROVISION_JOB_ID },
      }),
    () =>
      prisma.repositoryProvisionJob.upsert({
        where: { id: PROVISION_JOB_ID },
        update: { status: RepositoryProvisionJobStatus.SUCCEEDED },
        create: {
          id: PROVISION_JOB_ID,
          applicationId: APPLICATION_ID,
          repositoryId: REPOSITORY_ID,
          status: RepositoryProvisionJobStatus.SUCCEEDED,
          nextAttemptAt: offsetDays(-30),
          startedAt: offsetDays(-30),
          finishedAt: offsetDays(-30),
        },
      }),
  );

  // oss-hub-practice — 별도 Program·Team(학생 fork/배포 퀘스트 실습용). 같은 팀은 같은
  // Program에 신청을 한 건만 낼 수 있어(#164 partial unique index) 기존 oss-hub Program·Team을
  // 재사용할 수 없다 — 같은 네 명의 ADMIN 계정으로 새 Program·Team을 만든다.
  await upsertTracked(
    stats,
    'Program',
    () => prisma.program.findUnique({ where: { id: PRACTICE_PROGRAM_ID } }),
    () =>
      prisma.program.upsert({
        where: { id: PRACTICE_PROGRAM_ID },
        update: {
          name: PRACTICE_PROGRAM_NAME,
          organizer: PROGRAM_ORGANIZER,
          category: ProgramCategory.OSS_CONTEST,
          applicationTemplateKey: 'oss-contest',
          applicationTemplateVersion: 1,
          applicationStartAt: OSS_HUB_PRACTICE_CREATED_AT,
          applicationEndAt: offsetDays(60),
          startAt: offsetDays(61),
          endAt: offsetDays(120),
          teamMinSize: 4,
          teamMaxSize: 4,
          description: PRACTICE_PROGRAM_DESCRIPTION,
          repositoryProvisioningEnabled: true,
          notifyOnDeadline: false,
        },
        create: {
          id: PRACTICE_PROGRAM_ID,
          name: PRACTICE_PROGRAM_NAME,
          organizer: PROGRAM_ORGANIZER,
          category: ProgramCategory.OSS_CONTEST,
          applicationTemplateKey: 'oss-contest',
          applicationTemplateVersion: 1,
          applicationStartAt: OSS_HUB_PRACTICE_CREATED_AT,
          applicationEndAt: offsetDays(60),
          startAt: offsetDays(61),
          endAt: offsetDays(120),
          teamMinSize: 4,
          teamMaxSize: 4,
          description: PRACTICE_PROGRAM_DESCRIPTION,
          repositoryProvisioningEnabled: true,
        },
      }),
  );

  await upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: PRACTICE_TEAM_ID } }),
    () =>
      prisma.team.upsert({
        where: { id: PRACTICE_TEAM_ID },
        update: {
          name: 'oss-hub-practice',
          joinCodeDigest: computeJoinCodeDigest('SEED-OSS-HUB-PRACTICE'),
          leaderId: users[0]!.id,
        },
        create: {
          id: PRACTICE_TEAM_ID,
          programId: PRACTICE_PROGRAM_ID,
          name: 'oss-hub-practice',
          joinCodeDigest: computeJoinCodeDigest('SEED-OSS-HUB-PRACTICE'),
          leaderId: users[0]!.id,
        },
      }),
  );

  const practiceMemberIds = accounts.map((account) =>
    seedId('oss-hub-practice', 'team-member', account.githubId.toString()),
  );
  for (const [index, user] of users.entries()) {
    const id = practiceMemberIds[index]!;
    await upsertTracked(
      stats,
      'TeamMember',
      () => prisma.teamMember.findUnique({ where: { id } }),
      () =>
        prisma.teamMember.upsert({
          where: { id },
          update: {
            teamId: PRACTICE_TEAM_ID,
            programId: PRACTICE_PROGRAM_ID,
            userId: user.id,
          },
          create: {
            id,
            teamId: PRACTICE_TEAM_ID,
            programId: PRACTICE_PROGRAM_ID,
            userId: user.id,
          },
        }),
    );
  }

  await upsertTracked(
    stats,
    'Application',
    () =>
      prisma.application.findUnique({ where: { id: PRACTICE_APPLICATION_ID } }),
    () =>
      prisma.application.upsert({
        where: { id: PRACTICE_APPLICATION_ID },
        update: {
          status: ApplicationStatus.APPROVED,
        },
        create: {
          id: PRACTICE_APPLICATION_ID,
          programId: PRACTICE_PROGRAM_ID,
          applicantId: users[0]!.id,
          teamId: PRACTICE_TEAM_ID,
          answers: {
            applicantName: 'oss-hub',
            title: 'oss-hub-practice 학생 실습 저장소',
            summary: OSS_HUB_PRACTICE_DESCRIPTION,
          },
          applicationTemplateVersion: 1,
          status: ApplicationStatus.APPROVED,
          processedAt: OSS_HUB_PRACTICE_CREATED_AT,
        },
      }),
  );

  // 저장소 추적 — 실제 공개 저장소(github.com/JNU-SWCU/oss-hub-practice)를 연결·공개
  // 완료 상태로 표현한다. githubRepositoryId는 GitHub API로 확인한 실제 numeric id다.
  await upsertTracked(
    stats,
    'GithubRepository',
    () =>
      prisma.githubRepository.findUnique({
        where: { id: PRACTICE_REPOSITORY_ID },
      }),
    () =>
      prisma.githubRepository.upsert({
        where: { id: PRACTICE_REPOSITORY_ID },
        update: {
          githubRepositoryId: OSS_HUB_PRACTICE_GITHUB_REPOSITORY_ID,
          visibility: RepositoryVisibility.PUBLIC,
        },
        create: {
          id: PRACTICE_REPOSITORY_ID,
          applicationId: PRACTICE_APPLICATION_ID,
          programId: PRACTICE_PROGRAM_ID,
          teamId: PRACTICE_TEAM_ID,
          githubRepositoryId: OSS_HUB_PRACTICE_GITHUB_REPOSITORY_ID,
          nameWithOwner: OSS_HUB_PRACTICE_NAME_WITH_OWNER,
          source: RepositorySource.ORG_PROVISIONED,
          visibility: RepositoryVisibility.PUBLIC,
          publishedAt: OSS_HUB_PRACTICE_CREATED_AT,
        },
      }),
  );
  await upsertTracked(
    stats,
    'RepositoryProvisionJob',
    () =>
      prisma.repositoryProvisionJob.findUnique({
        where: { id: PRACTICE_PROVISION_JOB_ID },
      }),
    () =>
      prisma.repositoryProvisionJob.upsert({
        where: { id: PRACTICE_PROVISION_JOB_ID },
        update: { status: RepositoryProvisionJobStatus.SUCCEEDED },
        create: {
          id: PRACTICE_PROVISION_JOB_ID,
          applicationId: PRACTICE_APPLICATION_ID,
          repositoryId: PRACTICE_REPOSITORY_ID,
          status: RepositoryProvisionJobStatus.SUCCEEDED,
          nextAttemptAt: OSS_HUB_PRACTICE_CREATED_AT,
          startedAt: OSS_HUB_PRACTICE_CREATED_AT,
          finishedAt: OSS_HUB_PRACTICE_CREATED_AT,
        },
      }),
  );
}

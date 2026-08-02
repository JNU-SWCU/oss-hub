import {
  AccountStatus,
  ApplicationStatus,
  MilestoneSubmissionType,
  ProgramCategory,
  RepositoryProvisionJobStatus,
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
  upsertTracked,
} from './helpers';

const PROGRAM_ID = seedId('oss-hub', 'program');
const TEAM_ID = seedId('oss-hub', 'team');
const APPLICATION_ID = seedId('oss-hub', 'application');
const REPOSITORY_ID = seedId('oss-hub', 'repository');
const PROVISION_JOB_ID = seedId('oss-hub', 'provision-job');
/** JNU-SWCU/oss-hub 플랫폼 자체의 공개 저장소 — 실제 공개 URL 참조는 허용된다. */
const OSS_HUB_REPOSITORY_URL = 'https://github.com/JNU-SWCU/oss-hub';
const PROGRAM_NAME = '오픈소스 플랫폼 구축';
const PROGRAM_ORGANIZER = '오픈소스 SW 개발 사업단';
/** JNU-SWCU/oss-hub 공개 저장소의 실제 GitHub numeric id (GitHub REST API로 확인, public 정보). */
const OSS_HUB_GITHUB_REPOSITORY_ID = 1297138137n;
const PROGRAM_DESCRIPTION =
  '오픈소스 SW 개발 사업단이 주관하는 오픈소스 플랫폼 구축 프로그램. 참여 팀은 마일스톤별로 진행 상황과 산출물을 제출하고, GitHub 저장소를 통해 결과물을 공개한다. 공지 예시: [모집홍보] 2026 오픈소스 개발자대회 모집 안내 (https://sojoong.kr/notice/notice-board/?mod=document&uid=922); ｢모집홍보｣ 『LLMOps 파이프라인 개발』 교육 2026학년 2학기 자유학기(자유교과목) 신청 안내 (https://sojoong.kr/notice/notice-board/?mod=document&uid=939).';

/**
 * Notion "📅 Schedule" DB의 실제 프로젝트 마일스톤 날짜를 그대로 반영하는 고정 UTC Date.
 * `isoDate`는 Asia/Seoul 자정 기준이다 — offsetDays(SEED_NOW 상대)를 쓰지 않는다.
 */
function kstMidnight(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+09:00`);
}

async function upsertConfiguredUser(
  stats: SeedStats,
  account: OssHubTeamAccount,
): Promise<User> {
  const id = seedId('oss-hub', 'user', account.githubId.toString());
  return upsertTracked(
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
        },
        create: {
          id,
          githubId: account.githubId,
          nickname: account.login,
          role: Role.ADMIN,
          accountStatus: AccountStatus.ACTIVE,
        },
      }),
  );
}

type OssHubMilestoneSeed = {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
  readonly instructions: string;
};

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
          applicationStartAt: offsetDays(-30),
          applicationEndAt: offsetDays(30),
          endAt: offsetDays(90),
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
          applicationStartAt: offsetDays(-30),
          applicationEndAt: offsetDays(30),
          endAt: offsetDays(90),
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
      dueAt: kstMidnight('2026-08-08'),
      submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
      instructions:
        '승인된 AWS 구조에 staging 환경을 배포하고 HTTPS·헬스체크·롤백 절차를 검증합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'intake-freeze'),
      name: 'Intake 기능 동결',
      dueAt: kstMidnight('2026-08-08'),
      submissionType: MilestoneSubmissionType.TEXT,
      instructions:
        '프로그램 조회·신청·팀 구성·저장소 흐름의 happy path와 failure path를 모두 통과시켜 기능을 동결합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'intake-gate'),
      name: 'Intake Gate',
      dueAt: kstMidnight('2026-08-15'),
      submissionType: MilestoneSubmissionType.TEXT,
      instructions: '실사용자 시나리오와 권한·오류·회귀 검증을 완료합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'implementation-deadline'),
      name: '구현 마감',
      dueAt: kstMidnight('2026-08-21'),
      submissionType: MilestoneSubmissionType.TEXT,
      instructions:
        'PRD·IA 필수 기능과 운영 표면의 구현 PR을 모두 검토(review) 이상 상태로 만듭니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'dry-run'),
      name: 'Full-loop Dry-run',
      dueAt: kstMidnight('2026-08-24'),
      submissionType: MilestoneSubmissionType.FILE,
      instructions:
        '신청 → 저장소 → 활동 수집 → 마일스톤 → 검토 → 공개로 이어지는 전체 흐름을 합성 데이터로 재현합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'live-beta'),
      name: 'Full-loop Live Beta',
      // 스키마의 Milestone.dueAt은 단일 시각만 지원한다(기간 필드 없음). 검증 시작은
      // 2026-08-27이며 종료(마감)일 2026-08-29를 dueAt으로 쓰고, 시작일은 instructions에 남긴다.
      dueAt: kstMidnight('2026-08-29'),
      submissionType: MilestoneSubmissionType.TEXT,
      instructions:
        '승인된 베타 범위에서 2026-08-27부터 2026-08-29까지 실사용 검증을 진행하고 차단 이슈를 기록합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'release-complete'),
      name: 'Release Complete',
      dueAt: kstMidnight('2026-08-31'),
      submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
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
            dueAt: milestone.dueAt,
            submissionType: milestone.submissionType,
            instructions: milestone.instructions,
          },
          create: {
            id: milestone.id,
            programId: PROGRAM_ID,
            name: milestone.name,
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

  // aws-staging: 팀장이 staging 배포 릴리즈 링크를 제출, STAFF가 승인 리뷰를 남긴 상태.
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
          submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
          content: {
            type: MilestoneSubmissionType.REPOSITORY_RELEASE,
            releaseUrl: `${OSS_HUB_REPOSITORY_URL}/releases/tag/seed-aws-staging`,
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
    'Repository',
    () => prisma.repository.findUnique({ where: { id: REPOSITORY_ID } }),
    () =>
      prisma.repository.upsert({
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
          name: 'oss-hub',
          url: OSS_HUB_REPOSITORY_URL,
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
}

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
  '오픈소스 SW 개발 사업단이 주관하는 오픈소스 플랫폼 구축 프로그램. 참여 팀은 마일스톤별로 계획서·중간 점검·기능 시연·최종 발표를 제출하고, GitHub 저장소를 통해 결과물을 공개한다. 공지 예시: [모집홍보] 2026 오픈소스 개발자대회 모집 안내 (https://sojoong.kr/notice/notice-board/?mod=document&uid=922); ｢모집홍보｣ 『LLMOps 파이프라인 개발』 교육 2026학년 2학기 자유학기(자유교과목) 신청 안내 (https://sojoong.kr/notice/notice-board/?mod=document&uid=939).';

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

  // 마일스톤 전체 arc: 계획서 제출 → 중간 점검(완료, 리뷰 대기) → 기능 시연 → 최종 발표(예정).
  const milestones: readonly OssHubMilestoneSeed[] = [
    {
      id: seedId('oss-hub', 'milestone', 'plan'),
      name: '계획서 제출',
      dueAt: offsetDays(-21),
      submissionType: MilestoneSubmissionType.TEXT,
      instructions: '팀 목표와 일정, 참여 인원 역할을 정리해 제출합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'checkpoint'),
      name: '중간 점검',
      dueAt: offsetDays(-7),
      submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
      instructions: '진행 중인 저장소의 릴리즈 링크를 제출합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'demo'),
      name: '기능 시연',
      dueAt: offsetDays(14),
      submissionType: MilestoneSubmissionType.FILE,
      instructions:
        '핵심 기능을 시연하는 영상 또는 스크린샷 파일을 제출합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'final'),
      name: '최종 발표',
      dueAt: offsetDays(45),
      submissionType: MilestoneSubmissionType.TEXT,
      instructions: '최종 발표 자료 링크와 요약을 제출합니다.',
    },
  ] as const;
  // 과거 profile 실행이 남긴 다른 이름의 마일스톤(예: kickoff)을 정리한다 — 아래 제출은
  // 없었으므로 안전하게 삭제할 수 있다.
  await prisma.milestone.deleteMany({
    where: {
      programId: PROGRAM_ID,
      id: { notIn: milestones.map((milestone) => milestone.id) },
    },
  });
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
  const [planMilestone, checkpointMilestone] = milestones;

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

  // plan: 팀장이 제출, STAFF가 승인 리뷰를 남긴 상태.
  const planSubmissionId = seedId('oss-hub', 'submission', 'plan');
  await upsertTracked(
    stats,
    'Submission',
    () => prisma.submission.findUnique({ where: { id: planSubmissionId } }),
    () =>
      prisma.submission.upsert({
        where: { id: planSubmissionId },
        update: { status: SubmissionStatus.APPROVED, currentRevision: 1 },
        create: {
          id: planSubmissionId,
          milestoneId: planMilestone!.id,
          applicationId: APPLICATION_ID,
          status: SubmissionStatus.APPROVED,
          currentRevision: 1,
        },
      }),
  );
  const planRevisionId = seedId('oss-hub', 'submission', 'plan', 'revision-1');
  await upsertTracked(
    stats,
    'SubmissionRevision',
    () =>
      prisma.submissionRevision.findUnique({ where: { id: planRevisionId } }),
    () =>
      prisma.submissionRevision.upsert({
        where: { id: planRevisionId },
        update: {},
        create: {
          id: planRevisionId,
          submissionId: planSubmissionId,
          revision: 1,
          submissionType: MilestoneSubmissionType.TEXT,
          content: {
            type: MilestoneSubmissionType.TEXT,
            text: 'oss-hub 트래킹 플랫폼 확장 계획서입니다. 마일스톤 화면 실데이터 검증, 제출·리뷰 흐름 점검, 저장소 연동 상태 확인 순으로 진행합니다 (seed fixture).',
          },
          submittedById: users[0]!.id,
        },
      }),
  );
  const planReviewId = seedId('oss-hub', 'submission', 'plan', 'review');
  await upsertTracked(
    stats,
    'Review',
    () => prisma.review.findUnique({ where: { id: planReviewId } }),
    () =>
      prisma.review.upsert({
        where: { id: planReviewId },
        update: {
          decision: ReviewDecision.APPROVED,
          comment:
            '계획서에 목표와 일정이 명확하게 정리되어 있습니다. 이대로 진행해 주세요 (seed fixture).',
        },
        create: {
          id: planReviewId,
          submissionRevisionId: planRevisionId,
          reviewerId: AUTH_SCENARIOS['staff-approved'],
          decision: ReviewDecision.APPROVED,
          comment:
            '계획서에 목표와 일정이 명확하게 정리되어 있습니다. 이대로 진행해 주세요 (seed fixture).',
        },
      }),
  );

  // checkpoint: 다른 팀원이 릴리즈 링크를 제출했고 아직 리뷰 대기 중.
  const checkpointSubmissionId = seedId('oss-hub', 'submission', 'checkpoint');
  await upsertTracked(
    stats,
    'Submission',
    () =>
      prisma.submission.findUnique({ where: { id: checkpointSubmissionId } }),
    () =>
      prisma.submission.upsert({
        where: { id: checkpointSubmissionId },
        update: { status: SubmissionStatus.SUBMITTED, currentRevision: 1 },
        create: {
          id: checkpointSubmissionId,
          milestoneId: checkpointMilestone!.id,
          applicationId: APPLICATION_ID,
          status: SubmissionStatus.SUBMITTED,
          currentRevision: 1,
        },
      }),
  );
  const checkpointRevisionId = seedId(
    'oss-hub',
    'submission',
    'checkpoint',
    'revision-1',
  );
  await upsertTracked(
    stats,
    'SubmissionRevision',
    () =>
      prisma.submissionRevision.findUnique({
        where: { id: checkpointRevisionId },
      }),
    () =>
      prisma.submissionRevision.upsert({
        where: { id: checkpointRevisionId },
        update: {},
        create: {
          id: checkpointRevisionId,
          submissionId: checkpointSubmissionId,
          revision: 1,
          submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
          content: {
            type: MilestoneSubmissionType.REPOSITORY_RELEASE,
            releaseUrl: `${OSS_HUB_REPOSITORY_URL}/releases/tag/seed-checkpoint`,
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

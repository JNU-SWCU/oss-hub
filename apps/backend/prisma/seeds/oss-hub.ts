import {
  AccountStatus,
  ApplicationStatus,
  SubmissionHistoryEvent,
  ProgramCategory,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  SubmissionStatus,
  type User,
} from '@prisma/client';
import { AUTH_SCENARIOS } from './auth';
import {
  applicationTemplateKey,
  offsetDays,
  OssHubTeamAccount,
  prisma,
  seedId,
  SeedStats,
  upsertTracked,
} from './helpers';
import { setSeedAdmin, upsertConsent, upsertSeedProfile } from './user';
const PROGRAM_ID = seedId('oss-hub', 'program');
const TEAM_ID = seedId('oss-hub', 'team');
const APPLICATION_ID = seedId('oss-hub', 'team');
const REPOSITORY_ID = seedId('oss-hub', 'repository');
const PROVISION_JOB_ID = seedId('oss-hub', 'provision-job');
const OSS_HUB_REPOSITORY_NAME_WITH_OWNER = 'JNU-SWCU/oss-hub';
const PROGRAM_NAME = '오픈소스 플랫폼 구축';
const PROGRAM_ORGANIZER = '오픈소스 SW 개발 사업단';
const OSS_HUB_GITHUB_REPOSITORY_ID = 1297138137n;
const PROGRAM_DESCRIPTION =
  '오픈소스 SW 개발 사업단이 주관하는 오픈소스 플랫폼 구축 프로그램. 참여 팀은 마일스톤별로 진행 상황과 산출물을 제출하고, GitHub 저장소를 통해 결과물을 공개한다. 공지 예시: [모집홍보] 2026 오픈소스 개발자대회 모집 안내 (https://sojoong.kr/notice/notice-board/?mod=document&uid=922); ｢모집홍보｣ 『LLMOps 파이프라인 개발』 교육 2026학년 2학기 자유학기(자유교과목) 신청 안내 (https://sojoong.kr/notice/notice-board/?mod=document&uid=939).';
const PRACTICE_PROGRAM_ID = seedId('oss-hub-practice', 'program');
const PRACTICE_TEAM_ID = seedId('oss-hub-practice', 'team');
const PRACTICE_APPLICATION_ID = seedId('oss-hub-practice', 'team');
const PRACTICE_REPOSITORY_ID = seedId('oss-hub-practice', 'repository');
const PRACTICE_PROVISION_JOB_ID = seedId('oss-hub-practice', 'provision-job');
const PRACTICE_PROGRAM_NAME = '오픈소스 실습 배포 퀘스트';
const OSS_HUB_PRACTICE_REPOSITORY_URL =
  'https://github.com/JNU-SWCU/oss-hub-practice';
const OSS_HUB_PRACTICE_NAME_WITH_OWNER = 'JNU-SWCU/oss-hub-practice';
const OSS_HUB_PRACTICE_GITHUB_REPOSITORY_ID = 1296567792n;
const OSS_HUB_PRACTICE_CREATED_AT = kstMidnight('2026-07-10');
const OSS_HUB_PRACTICE_DESCRIPTION =
  'JNU OSS Hub practice repository for student fork and deployment quests (학생 fork/배포 퀘스트 실습용). 기본 브랜치는 main입니다.';
const PRACTICE_PROGRAM_DESCRIPTION = `학생이 ${OSS_HUB_PRACTICE_REPOSITORY_URL}를 fork하고 배포까지 완료하는 실습 퀘스트 프로그램입니다. ${OSS_HUB_PRACTICE_DESCRIPTION}`;
function kstMidnight(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+09:00`);
}
async function upsertConfiguredUser(
  stats: SeedStats,
  account: OssHubTeamAccount,
): Promise<User> {
  const id = seedId('oss-hub', 'user', account.githubId.toString());
  const user = await upsertTracked(
    stats,
    'User',
    () => prisma.user.findUnique({ where: { githubId: account.githubId } }),
    () =>
      prisma.$transaction(async (transaction) => {
        const seeded = await transaction.user.upsert({
          where: { githubId: account.githubId },
          update: {
            nickname: account.login,
            accountStatus: AccountStatus.ACTIVE,
          },
          create: {
            id,
            githubId: account.githubId,
            nickname: account.login,
            accountStatus: AccountStatus.ACTIVE,
          },
        });
        await setSeedAdmin(transaction, seeded.id, true);
        return seeded;
      }),
  );
  const displayName = account.displayName;
  if (displayName !== undefined) {
    await upsertSeedProfile({
      userId: user.id,
      name: displayName,
      studentId: user.studentId,
      department: '오픈소스 SW 개발 사업단',
      type: 'STAFF',
    });
    if (user.profileCreatedAt === null) stats.created('User.profile');
    else stats.updated('User.profile');
  }
  await upsertConsent(stats, user.id);
  return user;
}
type OssHubMilestoneSeed = {
  readonly id: string;
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly submissionType: 'FILE' | 'TEXT';
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
          applicationTemplateKey: applicationTemplateKey(
            ProgramCategory.OSS_CONTEST,
          ),
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
          applicationTemplateKey: applicationTemplateKey(
            ProgramCategory.OSS_CONTEST,
          ),
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
          leaderId: users[0]!.id,
        },
        create: {
          id: TEAM_ID,
          programId: PROGRAM_ID,
          name: 'oss-hub',
          leaderId: users[0]!.id,
          applicantId: users[0]!.id,
          answers: { title: 'oss-hub' },
          applicationTemplateVersion: 1,
        },
      }),
  );
  await upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: TEAM_ID } }),
    () =>
      prisma.team.update({
        where: { id: TEAM_ID },
        data: {
          programId: PROGRAM_ID,
          applicantId: users[0]!.id,
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
  const milestones: readonly OssHubMilestoneSeed[] = [
    {
      id: seedId('oss-hub', 'milestone', 'aws-staging'),
      name: 'AWS Staging',
      startAt: PROGRAM_START_AT,
      dueAt: kstMidnight('2026-08-08'),
      submissionType: 'TEXT',
      instructions:
        '승인된 AWS 구조에 staging 환경을 배포하고 HTTPS·헬스체크·롤백 절차를 검증합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'intake-freeze'),
      name: 'Intake 기능 동결',
      startAt: PROGRAM_START_AT,
      dueAt: kstMidnight('2026-08-08'),
      submissionType: 'TEXT',
      instructions:
        '프로그램 조회·신청·팀 구성·저장소 흐름의 happy path와 failure path를 모두 통과시켜 기능을 동결합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'intake-gate'),
      name: 'Intake Gate',
      startAt: PROGRAM_START_AT,
      dueAt: kstMidnight('2026-08-15'),
      submissionType: 'TEXT',
      instructions: '실사용자 시나리오와 권한·오류·회귀 검증을 완료합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'implementation-deadline'),
      name: '구현 마감',
      startAt: PROGRAM_START_AT,
      dueAt: kstMidnight('2026-08-21'),
      submissionType: 'TEXT',
      instructions:
        'PRD·IA 필수 기능과 운영 표면의 구현 PR을 모두 검토(review) 이상 상태로 만듭니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'dry-run'),
      name: 'Full-loop Dry-run',
      startAt: PROGRAM_START_AT,
      dueAt: kstMidnight('2026-08-24'),
      submissionType: 'FILE',
      instructions:
        '신청 → 저장소 → 활동 수집 → 마일스톤 → 검토 → 공개로 이어지는 전체 흐름을 합성 데이터로 재현합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'live-beta'),
      name: 'Full-loop Live Beta',
      startAt: kstMidnight('2026-08-27'),
      dueAt: kstMidnight('2026-08-31'),
      submissionType: 'TEXT',
      instructions:
        '승인된 베타 범위에서 실사용 검증을 진행하고 차단 이슈를 기록합니다.',
    },
    {
      id: seedId('oss-hub', 'milestone', 'release-complete'),
      name: 'Release Complete',
      startAt: PROGRAM_START_AT,
      dueAt: kstMidnight('2026-08-31'),
      submissionType: 'TEXT',
      instructions:
        '릴리스 체크리스트·운영 문서·복구 연습·최종 QA를 모두 완료합니다.',
    },
  ] as const;
  const newMilestoneIds = milestones.map((milestone) => milestone.id);
  const staleMilestones = await prisma.milestone.findMany({
    where: { programId: PROGRAM_ID, id: { notIn: newMilestoneIds } },
    select: { id: true },
  });
  const staleMilestoneIds = staleMilestones.map((milestone) => milestone.id);
  if (staleMilestoneIds.length > 0) {
    await prisma.submissionHistory.deleteMany({
      where: {
        submission: {
          requirement: { milestoneId: { in: staleMilestoneIds } },
        },
      },
    });
    await prisma.submission.deleteMany({
      where: {
        requirement: { milestoneId: { in: staleMilestoneIds } },
      },
    });
    await prisma.requirement.deleteMany({
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
            instructions: milestone.instructions,
          },
          create: {
            id: milestone.id,
            programId: PROGRAM_ID,
            name: milestone.name,
            startAt: milestone.startAt,
            dueAt: milestone.dueAt,
            instructions: milestone.instructions,
          },
        }),
    );
  }
  const [awsStagingMilestone, intakeFreezeMilestone] = milestones;
  await prisma.teamMember.deleteMany({
    where: { teamId: TEAM_ID, userId: { notIn: users.map((user) => user.id) } },
  });
  for (const user of users) {
    await upsertTracked(
      stats,
      'TeamMember',
      () =>
        prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId: TEAM_ID, userId: user.id } },
        }),
      () =>
        prisma.teamMember.upsert({
          where: { teamId_userId: { teamId: TEAM_ID, userId: user.id } },
          update: {
            teamId: TEAM_ID,
            programId: PROGRAM_ID,
            userId: user.id,
          },
          create: {
            teamId: TEAM_ID,
            programId: PROGRAM_ID,
            userId: user.id,
          },
        }),
    );
  }
  const awsStagingContent = {
    type: 'TEXT',
    text: 'staging 배포와 HTTPS·헬스체크·롤백 절차 검증을 완료했습니다 (seed fixture).',
  };
  const intakeFreezeContent = {
    type: 'TEXT',
    text: '프로그램 조회·신청·팀 구성·저장소 흐름의 happy/failure 경로 테스트를 마치고 기능을 동결했습니다 (seed fixture).',
  };
  const awsStagingDocumentId = seedId(
    'oss-hub',
    'milestone-document',
    'aws-staging',
  );
  const awsStagingSubmissionId = seedId(
    'oss-hub',
    'milestone-document-submission',
    'aws-staging',
  );
  const awsStagingHistoryId = seedId(
    'oss-hub',
    'milestone-document-submission-history',
    'aws-staging',
    'revision-1',
  );
  const awsStagingReviewId = seedId(
    'oss-hub',
    'milestone-document-review-history',
    'aws-staging',
  );
  await upsertTracked(
    stats,
    'MilestoneDocument',
    () =>
      prisma.requirement.findUnique({
        where: { id: awsStagingDocumentId },
      }),
    () =>
      prisma.requirement.upsert({
        where: { id: awsStagingDocumentId },
        update: { name: 'AWS Staging 결과', required: true, sortOrder: 0 },
        create: {
          id: awsStagingDocumentId,
          milestoneId: awsStagingMilestone!.id,
          name: 'AWS Staging 결과',
          required: true,
          sortOrder: 0,
        },
      }),
  );
  await upsertTracked(
    stats,
    'MilestoneDocumentSubmission',
    () =>
      prisma.submission.findUnique({
        where: { id: awsStagingSubmissionId },
      }),
    () =>
      prisma.submission.upsert({
        where: { id: awsStagingSubmissionId },
        update: {
          status: SubmissionStatus.APPROVED,
          content: awsStagingContent,
          revision: 1,
          submittedById: users[0]!.id,
        },
        create: {
          id: awsStagingSubmissionId,
          requirementId: awsStagingDocumentId,
          teamId: APPLICATION_ID,
          status: SubmissionStatus.APPROVED,
          content: awsStagingContent,
          revision: 1,
          submittedById: users[0]!.id,
        },
      }),
  );
  await upsertTracked(
    stats,
    'MilestoneDocumentSubmissionHistory',
    () =>
      prisma.submissionHistory.findUnique({
        where: { id: awsStagingHistoryId },
      }),
    () =>
      prisma.submissionHistory.upsert({
        where: { id: awsStagingHistoryId },
        update: { content: awsStagingContent },
        create: {
          id: awsStagingHistoryId,
          submissionId: awsStagingSubmissionId,
          event: SubmissionHistoryEvent.SUBMITTED,
          revision: 1,
          content: awsStagingContent,
          actorId: users[0]!.id,
        },
      }),
  );
  const awsStagingReviewComment =
    'staging 배포와 헬스체크·롤백 절차까지 확인했습니다. 통과 처리합니다 (seed fixture).';
  await upsertTracked(
    stats,
    'MilestoneDocumentSubmissionHistory',
    () =>
      prisma.submissionHistory.findUnique({
        where: { id: awsStagingReviewId },
      }),
    () =>
      prisma.submissionHistory.upsert({
        where: { id: awsStagingReviewId },
        update: { comment: awsStagingReviewComment },
        create: {
          id: awsStagingReviewId,
          submissionId: awsStagingSubmissionId,
          event: SubmissionHistoryEvent.APPROVED,
          revision: 1,
          comment: awsStagingReviewComment,
          actorId: AUTH_SCENARIOS['staff-approved'],
        },
      }),
  );
  const intakeFreezeDocumentId = seedId(
    'oss-hub',
    'milestone-document',
    'intake-freeze',
  );
  const intakeFreezeSubmissionId = seedId(
    'oss-hub',
    'milestone-document-submission',
    'intake-freeze',
  );
  const intakeFreezeHistoryId = seedId(
    'oss-hub',
    'milestone-document-submission-history',
    'intake-freeze',
    'revision-1',
  );
  const intakeFreezeSubmitterId = (users[2] ?? users[0])!.id;
  await upsertTracked(
    stats,
    'MilestoneDocument',
    () =>
      prisma.requirement.findUnique({
        where: { id: intakeFreezeDocumentId },
      }),
    () =>
      prisma.requirement.upsert({
        where: { id: intakeFreezeDocumentId },
        update: { name: 'Intake 기능 동결 요약', required: true, sortOrder: 0 },
        create: {
          id: intakeFreezeDocumentId,
          milestoneId: intakeFreezeMilestone!.id,
          name: 'Intake 기능 동결 요약',
          required: true,
          sortOrder: 0,
        },
      }),
  );
  await upsertTracked(
    stats,
    'MilestoneDocumentSubmission',
    () =>
      prisma.submission.findUnique({
        where: { id: intakeFreezeSubmissionId },
      }),
    () =>
      prisma.submission.upsert({
        where: { id: intakeFreezeSubmissionId },
        update: {
          status: SubmissionStatus.SUBMITTED,
          content: intakeFreezeContent,
          revision: 1,
          submittedById: intakeFreezeSubmitterId,
        },
        create: {
          id: intakeFreezeSubmissionId,
          requirementId: intakeFreezeDocumentId,
          teamId: APPLICATION_ID,
          status: SubmissionStatus.SUBMITTED,
          content: intakeFreezeContent,
          revision: 1,
          submittedById: intakeFreezeSubmitterId,
        },
      }),
  );
  await upsertTracked(
    stats,
    'MilestoneDocumentSubmissionHistory',
    () =>
      prisma.submissionHistory.findUnique({
        where: { id: intakeFreezeHistoryId },
      }),
    () =>
      prisma.submissionHistory.upsert({
        where: { id: intakeFreezeHistoryId },
        update: {
          content: intakeFreezeContent,
          actorId: intakeFreezeSubmitterId,
        },
        create: {
          id: intakeFreezeHistoryId,
          submissionId: intakeFreezeSubmissionId,
          event: SubmissionHistoryEvent.SUBMITTED,
          revision: 1,
          content: intakeFreezeContent,
          actorId: intakeFreezeSubmitterId,
        },
      }),
  );
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
          teamId: APPLICATION_ID,
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
          teamId: APPLICATION_ID,
          repositoryId: REPOSITORY_ID,
          status: RepositoryProvisionJobStatus.SUCCEEDED,
          nextAttemptAt: offsetDays(-30),
          startedAt: offsetDays(-30),
          finishedAt: offsetDays(-30),
        },
      }),
  );
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
          leaderId: users[0]!.id,
        },
        create: {
          id: PRACTICE_TEAM_ID,
          programId: PRACTICE_PROGRAM_ID,
          name: 'oss-hub-practice',
          leaderId: users[0]!.id,
          applicantId: users[0]!.id,
          answers: { title: 'oss-hub-practice' },
          applicationTemplateVersion: 1,
        },
      }),
  );
  for (const user of users) {
    await upsertTracked(
      stats,
      'TeamMember',
      () =>
        prisma.teamMember.findUnique({
          where: {
            teamId_userId: { teamId: PRACTICE_TEAM_ID, userId: user.id },
          },
        }),
      () =>
        prisma.teamMember.upsert({
          where: {
            teamId_userId: { teamId: PRACTICE_TEAM_ID, userId: user.id },
          },
          update: {
            teamId: PRACTICE_TEAM_ID,
            programId: PRACTICE_PROGRAM_ID,
            userId: user.id,
          },
          create: {
            teamId: PRACTICE_TEAM_ID,
            programId: PRACTICE_PROGRAM_ID,
            userId: user.id,
          },
        }),
    );
  }
  await upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: PRACTICE_TEAM_ID } }),
    () =>
      prisma.team.update({
        where: { id: PRACTICE_TEAM_ID },
        data: {
          programId: PRACTICE_PROGRAM_ID,
          applicantId: users[0]!.id,
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
          teamId: PRACTICE_APPLICATION_ID,
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
          teamId: PRACTICE_APPLICATION_ID,
          repositoryId: PRACTICE_REPOSITORY_ID,
          status: RepositoryProvisionJobStatus.SUCCEEDED,
          nextAttemptAt: OSS_HUB_PRACTICE_CREATED_AT,
          startedAt: OSS_HUB_PRACTICE_CREATED_AT,
          finishedAt: OSS_HUB_PRACTICE_CREATED_AT,
        },
      }),
  );
}

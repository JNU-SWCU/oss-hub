import {
  AccountStatus,
  MilestoneSubmissionType,
  ProgramCategory,
  Role,
  User,
} from '@prisma/client';
import { computeJoinCodeDigest } from '../../src/common/join-code-digest';
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
const PROGRAM_DESCRIPTION =
  'oss-hub 합성 프로그램 추적 fixture. 공지 예시: [모집홍보] 2026 오픈소스 개발자대회 모집 안내 (https://sojoong.kr/notice/notice-board/?mod=document&uid=922); ｢모집홍보｣ 『LLMOps 파이프라인 개발』 교육 2026학년 2학기 자유학기(자유교과목) 신청 안내 (https://sojoong.kr/notice/notice-board/?mod=document&uid=939).';

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
          name: 'oss-hub',
          organizer: 'oss-hub',
          category: ProgramCategory.OSS_CONTEST,
          applicationTemplateKey: ProgramCategory.OSS_CONTEST.toLowerCase(),
          applicationTemplateVersion: 1,
          applicationStartAt: offsetDays(-30),
          applicationEndAt: offsetDays(30),
          endAt: offsetDays(90),
          teamMinSize: 4,
          teamMaxSize: 4,
          description: PROGRAM_DESCRIPTION,
          repositoryProvisioningEnabled: false,
          notifyOnDeadline: false,
        },
        create: {
          id: PROGRAM_ID,
          name: 'oss-hub',
          organizer: 'oss-hub',
          category: ProgramCategory.OSS_CONTEST,
          applicationTemplateKey: ProgramCategory.OSS_CONTEST.toLowerCase(),
          applicationTemplateVersion: 1,
          applicationStartAt: offsetDays(-30),
          applicationEndAt: offsetDays(30),
          endAt: offsetDays(90),
          teamMinSize: 4,
          teamMaxSize: 4,
          description: PROGRAM_DESCRIPTION,
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

  const milestones = [
    {
      id: seedId('oss-hub', 'milestone', 'kickoff'),
      name: 'kickoff',
      dueAt: offsetDays(-1),
      submissionType: MilestoneSubmissionType.TEXT,
    },
    {
      id: seedId('oss-hub', 'milestone', 'checkpoint'),
      name: 'checkpoint',
      dueAt: offsetDays(14),
      submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
    },
  ] as const;
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
          },
          create: {
            ...milestone,
            programId: PROGRAM_ID,
          },
        }),
    );
  }

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
}

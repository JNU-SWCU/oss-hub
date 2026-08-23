import { MemberKind, ProgramCategory } from '@prisma/client';
import type { AuditLogService } from '../../audit-log/audit-log.service';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { computeJoinCodeDigest } from '../../common/join-code-digest';
import { DomainException } from '../../common/error-code';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgramTeamsRepository } from '../repository/program-teams.repository';
import { ProgramTeamsService } from './program-teams.service';
import { TEAMS_ERROR_CODES, TeamsErrorCode } from '../teams-error-code.enum';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
// 참여 코드 합류 정원 잠금(QA59, #164 패턴 이식) 전용 접두사.
const TEST_PREFIX = 'test:qa59:team-join-capacity:';
const JOIN_CODE_SECRET = `${TEST_PREFIX}secret`;
const JOIN_CODE = 'JOINCODE01';
const PROGRAM_ID = `${TEST_PREFIX}program`;
const TEAM_ID = `${TEST_PREFIX}team`;
const LEADER_ID = `${TEST_PREFIX}leader`;
const CHALLENGER_A_ID = `${TEST_PREFIX}challenger-a`;
const CHALLENGER_B_ID = `${TEST_PREFIX}challenger-b`;
const GITHUB_ID_BASE = 9_059_000_000n;
const NOW = new Date('2026-08-10T00:00:00.000Z');

const prisma = new PrismaService();
const repository = new ProgramTeamsRepository(prisma);
const service = new ProgramTeamsService(
  repository,
  loadRuntimeConfig({ TEAM_JOIN_CODE_SECRET: JOIN_CODE_SECRET }),
  { record: jest.fn() } as unknown as AuditLogService,
);

async function cleanup(): Promise<void> {
  await prisma.teamMember.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.team.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
  await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
}

async function seedTeamWithOneSlotLeft(): Promise<void> {
  await prisma.user.createMany({
    data: [
      {
        id: LEADER_ID,
        githubId: GITHUB_ID_BASE,
        nickname: 'synthetic-qa59-leader',
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus: 'ACTIVE',
      },
      {
        id: CHALLENGER_A_ID,
        githubId: GITHUB_ID_BASE + 1n,
        nickname: 'synthetic-qa59-challenger-a',
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus: 'ACTIVE',
      },
      {
        id: CHALLENGER_B_ID,
        githubId: GITHUB_ID_BASE + 2n,
        nickname: 'synthetic-qa59-challenger-b',
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus: 'ACTIVE',
      },
    ],
  });
  await prisma.program.create({
    data: {
      id: PROGRAM_ID,
      name: 'QA59 팀 정원 잠금 프로그램',
      organizer: 'Synthetic organizer',
      category: ProgramCategory.CAPSTONE,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
      description: 'Synthetic QA59 join-capacity fixture',
      teamMinSize: 1,
      teamMaxSize: 2,
    },
  });
  await prisma.team.create({
    data: {
      id: TEAM_ID,
      programId: PROGRAM_ID,
      name: 'QA59 팀',
      joinCodeDigest: computeJoinCodeDigest(JOIN_CODE, JOIN_CODE_SECRET),
      leaderId: LEADER_ID,
    },
  });
  await prisma.teamMember.create({
    data: { teamId: TEAM_ID, programId: PROGRAM_ID, userId: LEADER_ID },
  });
}

describe('참여 코드 합류 정원 잠금 (QA59, #164 패턴 이식)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await cleanup();
    await seedTeamWithOneSlotLeft();
  });

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('정원 1자리에 두 학생이 동시에 합류하면 정확히 한 명만 성공하고 나머지는 TEAM_FULL을 받는다', async () => {
    const outcomes = await Promise.allSettled([
      service.join(GITHUB_ID_BASE + 1n, PROGRAM_ID, JOIN_CODE, NOW),
      service.join(GITHUB_ID_BASE + 2n, PROGRAM_ID, JOIN_CODE, NOW),
    ]);

    const fulfilled = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled',
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const [loser] = rejected;
    if (!loser) throw new Error('expected one rejected outcome');
    expect(loser.reason).toBeInstanceOf(DomainException);
    expect(loser.reason).toMatchObject({
      errorCode: TEAMS_ERROR_CODES[TeamsErrorCode.TEAM_FULL],
    });

    const finalCount = await prisma.teamMember.count({
      where: { teamId: TEAM_ID },
    });
    expect(finalCount).toBe(2);
  });
});

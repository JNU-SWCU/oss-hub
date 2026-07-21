import { Prisma, PrismaClient } from '@prisma/client';

import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:164:';
const PROGRAM_ID = `${TEST_PREFIX}program`;
const SECOND_PROGRAM_ID = `${TEST_PREFIX}program:second`;
const USER_A_ID = `${TEST_PREFIX}user:a`;
const USER_B_ID = `${TEST_PREFIX}user:b`;
const USER_C_ID = `${TEST_PREFIX}user:c`;
const TEAM_A_ID = `${TEST_PREFIX}team:a`;
const TEAM_B_ID = `${TEST_PREFIX}team:b`;

const prisma = new PrismaClient();

async function createUsers(): Promise<void> {
  await prisma.user.createMany({
    data: [
      { id: USER_A_ID, githubId: 9_164_000_001n, login: 'synthetic-164-a' },
      { id: USER_B_ID, githubId: 9_164_000_002n, login: 'synthetic-164-b' },
      { id: USER_C_ID, githubId: 9_164_000_003n, login: 'synthetic-164-c' },
    ],
  });
}

async function createProgram(
  id: string = PROGRAM_ID,
  overrides: Readonly<{
    applicationStartAt?: Date;
    applicationEndAt?: Date;
    teamMinSize?: number | null;
    teamMaxSize?: number | null;
  }> = {},
): Promise<void> {
  await prisma.program.create({
    data: {
      id,
      name: id,
      organizer: 'synthetic-organizer',
      category: 'BASIC',
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt:
        overrides.applicationStartAt ?? new Date('2026-08-01T00:00:00Z'),
      applicationEndAt:
        overrides.applicationEndAt ?? new Date('2026-08-02T00:00:00Z'),
      teamMinSize: overrides.teamMinSize,
      teamMaxSize: overrides.teamMaxSize,
      description: 'synthetic-description',
    },
  });
}

async function createTeam(
  id: string,
  programId: string,
  leaderId: string,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "Team" (
      "id", "programId", "name", "joinCodeDigest", "leaderId", "createdAt", "updatedAt"
    ) VALUES (
      ${id}, ${programId}, ${id}, ${`digest:${id}`}, ${leaderId}, NOW(), NOW()
    )
  `;
}

async function cleanFixtures(): Promise<void> {
  await prisma.application.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.teamMember.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.team.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  await prisma.roleRequest.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.program.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
}

describe('core schema invariants integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await cleanFixtures();
    await createUsers();
  });

  afterEach(cleanFixtures);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('개인 신청은 같은 프로그램에서 사용자당 한 건만 허용한다', async () => {
    // Given
    await createProgram();
    await prisma.application.create({
      data: {
        id: `${TEST_PREFIX}application:personal:first`,
        programId: PROGRAM_ID,
        applicantId: USER_A_ID,
        answers: {},
        applicationTemplateVersion: 1,
      },
    });

    // When
    const duplicateInsert = prisma.application.create({
      data: {
        id: `${TEST_PREFIX}application:personal:second`,
        programId: PROGRAM_ID,
        applicantId: USER_A_ID,
        answers: {},
        applicationTemplateVersion: 1,
      },
    });

    // Then
    await expect(duplicateInsert).rejects.toMatchObject({ code: 'P2002' });
  });

  it('팀 신청은 같은 프로그램에서 팀당 한 건만 허용한다', async () => {
    // Given
    await createProgram();
    await createTeam(TEAM_A_ID, PROGRAM_ID, USER_A_ID);
    await prisma.application.create({
      data: {
        id: `${TEST_PREFIX}application:team:first`,
        programId: PROGRAM_ID,
        applicantId: USER_A_ID,
        teamId: TEAM_A_ID,
        answers: {},
        applicationTemplateVersion: 1,
      },
    });

    // When
    const duplicateInsert = prisma.application.create({
      data: {
        id: `${TEST_PREFIX}application:team:second`,
        programId: PROGRAM_ID,
        applicantId: USER_B_ID,
        teamId: TEAM_A_ID,
        answers: {},
        applicationTemplateVersion: 1,
      },
    });

    // Then
    await expect(duplicateInsert).rejects.toMatchObject({ code: 'P2002' });
  });

  it('사용자는 같은 프로그램의 두 팀에 동시에 속할 수 없다', async () => {
    // Given
    await createProgram();
    await createTeam(TEAM_A_ID, PROGRAM_ID, USER_A_ID);
    await createTeam(TEAM_B_ID, PROGRAM_ID, USER_B_ID);
    await prisma.$executeRaw`
      INSERT INTO "TeamMember" ("id", "teamId", "programId", "userId", "createdAt")
      VALUES (${`${TEST_PREFIX}member:first`}, ${TEAM_A_ID}, ${PROGRAM_ID}, ${USER_C_ID}, NOW())
    `;

    // When
    const duplicateInsert = prisma.$executeRaw`
      INSERT INTO "TeamMember" ("id", "teamId", "programId", "userId", "createdAt")
      VALUES (${`${TEST_PREFIX}member:second`}, ${TEAM_B_ID}, ${PROGRAM_ID}, ${USER_C_ID}, NOW())
    `;

    // Then
    await expect(duplicateInsert).rejects.toMatchObject({ code: 'P2010' });
  });

  it('팀 멤버의 programId는 소속 팀의 programId와 같아야 한다', async () => {
    // Given
    await createProgram();
    await createProgram(SECOND_PROGRAM_ID);
    await createTeam(TEAM_A_ID, PROGRAM_ID, USER_A_ID);

    // When
    const mismatchedInsert = prisma.$executeRaw`
      INSERT INTO "TeamMember" ("id", "teamId", "programId", "userId", "createdAt")
      VALUES (${`${TEST_PREFIX}member:mismatch`}, ${TEAM_A_ID}, ${SECOND_PROGRAM_ID}, ${USER_C_ID}, NOW())
    `;

    // Then
    await expect(mismatchedInsert).rejects.toMatchObject({ code: 'P2010' });
  });

  it('사용자당 PENDING 역할 요청은 한 건만 허용한다', async () => {
    // Given
    await prisma.roleRequest.create({
      data: { id: `${TEST_PREFIX}role:first`, userId: USER_A_ID },
    });

    // When
    const duplicateInsert = prisma.roleRequest.create({
      data: { id: `${TEST_PREFIX}role:second`, userId: USER_A_ID },
    });

    // Then
    await expect(duplicateInsert).rejects.toMatchObject({ code: 'P2002' });
  });

  it.each([
    {
      name: '신청 종료가 시작보다 빠른 프로그램',
      overrides: {
        applicationStartAt: new Date('2026-08-02T00:00:00Z'),
        applicationEndAt: new Date('2026-08-01T00:00:00Z'),
      },
    },
    {
      name: '팀 최소 인원이 1보다 작은 프로그램',
      overrides: { teamMinSize: 0, teamMaxSize: 2 },
    },
    {
      name: '팀 최소 인원이 최대 인원보다 큰 프로그램',
      overrides: { teamMinSize: 3, teamMaxSize: 2 },
    },
  ])('$name은 저장할 수 없다', async ({ overrides }) => {
    // Given: 각 케이스의 잘못된 기간 또는 팀 인원 설정.

    // When
    const invalidInsert = createProgram(PROGRAM_ID, overrides);

    // Then
    await expect(invalidInsert).rejects.toBeInstanceOf(
      Prisma.PrismaClientUnknownRequestError,
    );
  });
});

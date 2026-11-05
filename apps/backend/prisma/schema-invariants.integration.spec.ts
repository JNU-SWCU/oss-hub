import { Prisma, PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inLegacyUserSchema } from './legacy-user-migration.fixture';

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
      {
        id: USER_A_ID,
        githubId: 9_164_000_001n,
        nickname: 'synthetic-164-a',
      },
      {
        id: USER_B_ID,
        githubId: 9_164_000_002n,
        nickname: 'synthetic-164-b',
      },
      {
        id: USER_C_ID,
        githubId: 9_164_000_003n,
        nickname: 'synthetic-164-c',
      },
    ],
  });
}

async function createProgram(
  id: string = PROGRAM_ID,
  overrides: Readonly<{
    applicationStartAt?: Date;
    applicationEndAt?: Date;
    teamMinSize?: number;
    teamMaxSize?: number;
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
      startAt: new Date('2026-08-02T00:00:00Z'),
      endAt: new Date('2026-09-01T00:00:00Z'),
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
      "id", "programId", "name", "leaderId", "createdAt", "updatedAt", "applicantId", "answers", "applicationTemplateVersion"
    ) VALUES (
      ${id}, ${programId}, ${id}, ${leaderId}, NOW(), NOW(), ${leaderId}, '{}'::jsonb, 1
    )
  `;
}

async function cleanFixtures(): Promise<void> {
  await prisma.repositoryProvisionJob.deleteMany({ where: { teamId: { startsWith: TEST_PREFIX } } });
  await prisma.teamMember.deleteMany({
    where: { teamId: { startsWith: TEST_PREFIX } },
  });
  await prisma.team.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
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

  it('a team identity can hold only one application state', async () => {
    await createProgram();
    await createTeam(TEAM_A_ID, PROGRAM_ID, USER_A_ID);
    await expect(prisma.team.create({ data: {
      id: TEAM_A_ID, programId: PROGRAM_ID, name: 'Duplicate team', leaderId: USER_B_ID,
      applicantId: USER_B_ID, answers: {}, applicationTemplateVersion: 1,
    } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('RepositoryProvisionJob.teamId restricts deletion of its owning team', async () => {
    await createProgram();
    await createTeam(TEAM_A_ID, PROGRAM_ID, USER_A_ID);
    await prisma.repositoryProvisionJob.create({ data: { teamId: TEAM_A_ID } });
    await expect(prisma.team.delete({ where: { id: TEAM_A_ID } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('사용자는 같은 프로그램의 두 팀에 동시에 속할 수 없다', async () => {
    await createProgram();
    await createTeam(TEAM_A_ID, PROGRAM_ID, USER_A_ID);
    await createTeam(TEAM_B_ID, PROGRAM_ID, USER_B_ID);
    await prisma.$executeRaw`
      INSERT INTO "TeamMember" ("teamId", "programId", "userId", "createdAt")
      VALUES (${TEAM_A_ID}, ${PROGRAM_ID}, ${USER_C_ID}, NOW())
    `;

    const duplicateInsert = prisma.$executeRaw`
      INSERT INTO "TeamMember" ("teamId", "programId", "userId", "createdAt")
      VALUES (${TEAM_B_ID}, ${PROGRAM_ID}, ${USER_C_ID}, NOW())
    `;

    await expect(duplicateInsert).rejects.toMatchObject({ code: 'P2010' });
  });

  it('팀 멤버의 programId는 소속 팀의 programId와 같아야 한다', async () => {
    await createProgram();
    await createProgram(SECOND_PROGRAM_ID);
    await createTeam(TEAM_A_ID, PROGRAM_ID, USER_A_ID);

    const mismatchedInsert = prisma.$executeRaw`
      INSERT INTO "TeamMember" ("teamId", "programId", "userId", "createdAt")
      VALUES (${TEAM_A_ID}, ${SECOND_PROGRAM_ID}, ${USER_C_ID}, NOW())
    `;

    await expect(mismatchedInsert).rejects.toMatchObject({ code: 'P2010' });
  });

  it('사용자당 PENDING 역할 요청은 한 건만 허용한다', async () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260720034625_core_schema_invariants/migration.sql',
      ),
      'utf8',
    );
    const pendingIndex = migration
      .split(';')
      .find((statement) =>
        statement.includes(
          'CREATE UNIQUE INDEX "RoleRequest_userId_pending_key"',
        ),
      );
    if (pendingIndex === undefined)
      throw new TypeError('Missing legacy pending-request index');
    const duplicateInsert = inLegacyUserSchema(prisma, async (transaction) => {
      await transaction.$executeRaw`INSERT INTO "User" ("id") VALUES (${USER_A_ID})`;
      await transaction.$executeRawUnsafe(pendingIndex);
      await transaction.$executeRaw`
        INSERT INTO "RoleRequest" ("id", "userId")
        VALUES (${`${TEST_PREFIX}role:first`}, ${USER_A_ID})
      `;
      await transaction.$executeRaw`
        INSERT INTO "RoleRequest" ("id", "userId")
        VALUES (${`${TEST_PREFIX}role:second`}, ${USER_A_ID})
      `;
    });
    await expect(duplicateInsert).rejects.toMatchObject({
      code: 'P2010',
      meta: { code: '23505' },
    });
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
    const invalidInsert = createProgram(PROGRAM_ID, overrides);

    await expect(invalidInsert).rejects.toBeInstanceOf(
      Prisma.PrismaClientUnknownRequestError,
    );
  });
});

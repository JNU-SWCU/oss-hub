import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { prisma as seedPrisma, SeedStats } from '../../prisma/seeds/helpers';
import { seedAuth } from '../../prisma/seeds/auth';
import {
  E2E_DOCUMENT_ID,
  E2E_MILESTONE_ID,
  E2E_PROGRAM_ID,
  E2E_STAFF_ID,
  E2eProgramAuthoringFixture,
} from './e2e-program-authoring-fixture';
import { e2eProgramAuthoringExternalPorts } from './e2e-external-ports';
import { PrismaService } from '../prisma/prisma.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const fixture = new E2eProgramAuthoringFixture(prisma);

beforeAll(async () => {
  await prisma.$connect();
  await seedAuth(new SeedStats());
});

afterEach(async () => {
  await fixture.reset();
  e2eProgramAuthoringExternalPorts.reset();
});

afterAll(async () => {
  await prisma.$disconnect();
  await seedPrisma.$disconnect();
});

describe('E2eProgramAuthoringFixture persistence', () => {
  it('creates the sanitized graph after reset on an auth-seeded schema', async () => {
    // Given
    await fixture.reset();

    // When
    await fixture.ensure();
    const graph = fixture.graph();
    const state = await fixture.state(
      e2eProgramAuthoringExternalPorts.capture(),
    );

    // Then
    expect(graph).toEqual({
      programId: E2E_PROGRAM_ID,
      milestoneId: E2E_MILESTONE_ID,
      documentId: E2E_DOCUMENT_ID,
    });
    expect(state).toMatchObject({
      programs: 1,
      milestones: 1,
      // The isolated one-milestone fixture still expects only its own document;
      // the browser happy path separately proves the two-document program graph.
      documents: 1,
      applications: 0,
      notifications: 0,
    });
  });

  it('resets the graph while preserving append-only fixture actor history', async () => {
    // Given
    await fixture.reset();
    await fixture.ensure();
    await prisma.auditLog.create({
      data: {
        actorId: E2E_STAFF_ID,
        action: 'E2E_FIXTURE_RESET',
        targetType: 'PROGRAM',
        targetId: E2E_PROGRAM_ID,
        metadata: {},
      },
    });

    // When
    await fixture.reset();

    // Then
    await expect(
      prisma.auditLog.count({ where: { actorId: E2E_STAFF_ID } }),
    ).resolves.toBe(1);
    await expect(
      prisma.user.findUnique({ where: { id: E2E_STAFF_ID } }),
    ).resolves.toMatchObject({ id: E2E_STAFF_ID });
  });
});

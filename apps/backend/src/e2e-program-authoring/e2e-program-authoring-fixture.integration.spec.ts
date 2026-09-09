import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { prisma as seedPrisma, SeedStats } from '../../prisma/seeds/helpers';
import { seedAuth } from '../../prisma/seeds/auth';
import {
  E2E_DOCUMENT_ID,
  E2E_MILESTONE_ID,
  E2E_PROGRAM_ID,
  E2E_STAFF_ID,
  E2E_STUDENT_ID,
  E2eProgramAuthoringFixture,
} from './e2e-program-authoring-fixture';
import { e2eProgramAuthoringExternalPorts } from './e2e-external-ports';
import { PrismaService } from '../prisma/prisma.service';
import { seedE2eRepositoryEvidence } from './e2e-repository-evidence.fixture';

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
    await expect(
      prisma.user.findUnique({ where: { id: E2E_STAFF_ID } }),
    ).resolves.toMatchObject({
      notificationEmail: null,
      notifyEnabled: false,
    });
  });

  it('adopt 경로의 교직원 알림 opt-in이 남아도 reset 뒤 기본 fixture는 비수신 상태를 복원한다', async () => {
    await fixture.reset();
    await fixture.ensure();
    await prisma.user.update({
      where: { id: E2E_STAFF_ID },
      data: {
        notificationEmail: 'e2e-program-authoring-staff@fixture.invalid',
        notifyEnabled: true,
      },
    });

    await fixture.reset();
    await fixture.ensure();

    await expect(
      prisma.user.findUnique({ where: { id: E2E_STAFF_ID } }),
    ).resolves.toMatchObject({
      notificationEmail: null,
      notifyEnabled: false,
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

it('removes detached fixture repository facts while preserving a neighboring program', async () => {
  // Given: relink leaves the old repository attached to the program, not the application.
  await fixture.reset();
  await fixture.ensure();
  const neighborId = `${E2E_PROGRAM_ID}-repository-neighbor`;
  await prisma.program.create({
    data: {
      id: neighborId,
      name: 'Synthetic neighboring program',
      organizer: 'Synthetic',
      category: 'BASIC',
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      description: 'Synthetic reset isolation',
      applicationStartAt: new Date('2026-01-01Z'),
      applicationEndAt: new Date('2026-01-31Z'),
    },
  });
  const detachedId = `${E2E_PROGRAM_ID}-detached`;
  const neighborRepositoryId = `${neighborId}-repository`;
  await prisma.githubRepository.createMany({
    data: [
      {
        id: detachedId,
        programId: E2E_PROGRAM_ID,
        githubRepositoryId: 9_910_001n,
        nameWithOwner: 'synthetic/detached',
        source: 'EXTERNAL_PUBLIC',
      },
      {
        id: neighborRepositoryId,
        programId: neighborId,
        githubRepositoryId: 9_910_002n,
        nameWithOwner: 'synthetic/neighbor',
        source: 'EXTERNAL_PUBLIC',
      },
    ],
  });
  await prisma.contribution.createMany({
    data: [detachedId, neighborRepositoryId].map((repositoryId) => ({
      repositoryId,
      githubId: 8_100_002n,
      date: new Date('2026-08-01Z'),
      commitCount: 7,
    })),
  });

  // When
  await fixture.reset();

  // Then
  expect(
    await prisma.githubRepository.findUnique({ where: { id: detachedId } }),
  ).toBeNull();
  expect(
    await prisma.contribution.count({ where: { repositoryId: detachedId } }),
  ).toBe(0);
  expect(
    await prisma.program.findUnique({ where: { id: neighborId } }),
  ).not.toBeNull();
  expect(
    await prisma.contribution.findMany({
      where: { repositoryId: neighborRepositoryId },
    }),
  ).toEqual([expect.objectContaining({ commitCount: 7 })]);
});

it('seeds current observations idempotently without reassigning detached facts', async () => {
  // Given
  await fixture.ensure();
  const teamId = `${E2E_PROGRAM_ID}-evidence-team`;
  const applicationId = `${E2E_PROGRAM_ID}-evidence-application`;
  const oldId = `${E2E_PROGRAM_ID}-evidence-old`;
  const currentId = `${E2E_PROGRAM_ID}-evidence-current`;
  await prisma.team.create({
    data: {
      id: teamId,
      programId: E2E_PROGRAM_ID,
      name: 'Synthetic evidence team',
      joinCodeDigest: teamId,
      leaderId: E2E_STUDENT_ID,
    },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId: E2E_PROGRAM_ID,
      teamId,
      applicantId: E2E_STUDENT_ID,
      status: 'APPROVED',
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
  await prisma.githubRepository.create({
    data: {
      id: oldId,
      programId: E2E_PROGRAM_ID,
      applicationId,
      teamId,
      githubRepositoryId: 9_910_003n,
      nameWithOwner: 'synthetic/evidence-old',
      source: 'EXTERNAL_PUBLIC',
    },
  });
  const old = await seedE2eRepositoryEvidence(prisma, fixture.graph());
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { applicationId: null },
  });
  await prisma.githubRepository.create({
    data: {
      id: currentId,
      programId: E2E_PROGRAM_ID,
      applicationId,
      teamId,
      githubRepositoryId: 9_910_004n,
      nameWithOwner: 'synthetic/evidence-current',
      source: 'EXTERNAL_PUBLIC',
    },
  });

  // When
  const first = await seedE2eRepositoryEvidence(prisma, fixture.graph());
  const second = await seedE2eRepositoryEvidence(prisma, fixture.graph());

  // Then
  expect(second).toEqual(first);
  expect(second.currentRepositoryId).toBe(currentId);
  expect(second.facts.filter((fact) => fact.repositoryId === oldId)).toEqual(
    old.facts,
  );
  expect(
    second.facts.filter((fact) => fact.repositoryId === currentId),
  ).toEqual([
    expect.objectContaining({
      githubId: '8100002',
      commitCount: 7,
      pullRequestCount: 2,
      releaseCount: 1,
    }),
    expect.objectContaining({
      githubId: '8199999',
      commitCount: 5,
      pullRequestCount: 1,
      releaseCount: 0,
    }),
  ]);
});

it('rejects adopted graphs and missing approved applications without seeding facts', async () => {
  // Given
  await fixture.ensure();
  // When / Then
  await expect(
    seedE2eRepositoryEvidence(prisma, {
      ...fixture.graph(),
      programId: 'synthetic-adopted',
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    seedE2eRepositoryEvidence(prisma, fixture.graph()),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await prisma.contribution.count({
      where: { repository: { programId: E2E_PROGRAM_ID } },
    }),
  ).toBe(0);
});

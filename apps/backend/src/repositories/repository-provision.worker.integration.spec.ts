import {
  ApplicationStatus,
  OutboxEventStatus,
  ProgramCategory,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import {
  COLLABORATOR_OUTCOMES,
  type GithubAppClient,
  type GithubRepositoryMetadata,
} from './github-app.client';
import { RepositoriesRepository } from './repositories.repository';
import { RepositoryOutboxConsumer } from './repository-outbox.consumer';
import { REPOSITORY_PROVISION_EVENT_TYPE } from './repository-provision-event';
import { RepositoryProvisionJobRepository } from './repository-provision-job.repository';
import { RepositoryProvisionStateRepository } from './repository-provision-state.repository';
import { RepositoryProvisionWorker } from './repository-provision.worker';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const outbox = new RepositoryOutboxConsumer(new RepositoriesRepository(prisma));
const jobs = new RepositoryProvisionJobRepository(prisma);
const state = new RepositoryProvisionStateRepository(prisma);
const NOW = new Date('2026-07-22T00:00:00.000Z');
const APPLICANT_ID = 'synthetic-worker-applicant-id';
const APPLICATION_IDS = [
  'synthetic-worker-success',
  'synthetic-worker-partial',
] as const;

type ProvisionGithubClient = jest.Mocked<
  Pick<
    GithubAppClient,
    'findRepository' | 'createRepository' | 'ensureCollaborator'
  >
>;

describe('RepositoryProvisionWorker integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: APPLICANT_ID,
        githubId: 8_300_000_000_001n,
        login: 'synthetic-worker-applicant',
        role: Role.STUDENT,
      },
    });
  });

  afterEach(async () => {
    await prisma.repositoryInvitation.deleteMany({
      where: { repository: { applicationId: { in: [...APPLICATION_IDS] } } },
    });
    await prisma.repositoryProvisionJob.deleteMany({
      where: { applicationId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.repository.deleteMany({
      where: { applicationId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.application.deleteMany({
      where: { id: { in: [...APPLICATION_IDS] } },
    });
    await prisma.program.deleteMany({
      where: { id: { in: APPLICATION_IDS.map(programId) } },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: APPLICANT_ID } });
    await prisma.$disconnect();
  });

  it('outbox부터 private repository와 snapshot invitation까지 완료한다', async () => {
    // Given: 승인된 신청 outbox가 job으로 변환됐다.
    const applicationId = APPLICATION_IDS[0];
    await createApplicationAndEvent(applicationId, [
      'synthetic-leader',
      'synthetic-student',
    ]);
    await outbox.consumeNext('outbox-worker-a', NOW);
    const github = githubClient();
    github.ensureCollaborator
      .mockResolvedValueOnce(COLLABORATOR_OUTCOMES.PENDING)
      .mockResolvedValueOnce(COLLABORATOR_OUTCOMES.SUCCEEDED);
    const worker = new RepositoryProvisionWorker(jobs, state, github);

    // When: provision worker가 job을 처리한다.
    const result = await worker.runNext('provision-worker-a', NOW);

    // Then: private repository 한 건과 snapshot별 invitation이 저장된다.
    expect(result.kind).toBe('SUCCEEDED');
    const repository = await prisma.repository.findUniqueOrThrow({
      where: { applicationId },
      include: { invitations: { orderBy: { githubLogin: 'asc' } } },
    });
    expect(repository.visibility).toBe(RepositoryVisibility.PRIVATE);
    expect(
      repository.invitations.map(({ githubLogin, status }) => [
        githubLogin,
        status,
      ]),
    ).toEqual([
      ['synthetic-leader', RepositoryInvitationStatus.PENDING],
      ['synthetic-student', RepositoryInvitationStatus.SUCCEEDED],
    ]);
  });

  it('일부 초대 재시도에서 repository를 다시 만들지 않는다', async () => {
    // Given: 첫 실행에서 두 번째 invitation만 일시 실패한다.
    const applicationId = APPLICATION_IDS[1];
    await createApplicationAndEvent(applicationId, [
      'synthetic-leader',
      'synthetic-student',
    ]);
    await outbox.consumeNext('outbox-worker-b', NOW);
    const github = githubClient();
    github.ensureCollaborator
      .mockResolvedValueOnce(COLLABORATOR_OUTCOMES.SUCCEEDED)
      .mockRejectedValueOnce(
        new GithubOperationsError(GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM, true),
      );
    const worker = new RepositoryProvisionWorker(jobs, state, github);
    await worker.runNext('provision-worker-b', NOW);

    // When: backoff 뒤 같은 job을 재시도한다.
    github.ensureCollaborator.mockResolvedValue(
      COLLABORATOR_OUTCOMES.SUCCEEDED,
    );
    const result = await worker.runNext(
      'provision-worker-c',
      new Date(NOW.getTime() + 60_000),
    );

    // Then: 실패 대상만 다시 초대하고 repository와 job은 한 건으로 수렴한다.
    expect(result.kind).toBe('SUCCEEDED');
    expect(github.createRepository.mock.calls).toHaveLength(1);
    expect(github.ensureCollaborator.mock.calls.map((call) => call[1])).toEqual(
      ['synthetic-leader', 'synthetic-student', 'synthetic-student'],
    );
    await expect(
      prisma.repository.count({ where: { applicationId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      attemptCount: 2,
    });
  });
});

function programId(applicationId: string): string {
  return `${applicationId}-program`;
}

function githubClient(): ProvisionGithubClient {
  return {
    findRepository: jest.fn().mockResolvedValue(null),
    createRepository: jest.fn((name: string) =>
      Promise.resolve(repositoryMetadata(name)),
    ),
    ensureCollaborator: jest
      .fn()
      .mockResolvedValue(COLLABORATOR_OUTCOMES.SUCCEEDED),
  };
}

function repositoryMetadata(name: string): GithubRepositoryMetadata {
  return {
    githubRepositoryId: 987654321n,
    name,
    url: `https://github.com/synthetic-org/${name}`,
    visibility: RepositoryVisibility.PRIVATE,
  };
}

async function createApplicationAndEvent(
  applicationId: string,
  collaboratorGithubLogins: readonly string[],
): Promise<void> {
  await prisma.program.create({
    data: {
      id: programId(applicationId),
      name: 'Synthetic Program',
      organizer: 'synthetic-organizer',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'synthetic-template',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      description: 'synthetic-description',
      repositoryProvisioningEnabled: true,
      applications: {
        create: {
          id: applicationId,
          applicantId: APPLICANT_ID,
          answers: { synthetic: true },
          applicationTemplateVersion: 1,
          status: ApplicationStatus.APPROVED,
        },
      },
    },
  });
  await prisma.outboxEvent.create({
    data: {
      type: REPOSITORY_PROVISION_EVENT_TYPE,
      aggregateType: 'Application',
      aggregateId: applicationId,
      idempotencyKey: `repository-provision:${applicationId}`,
      payload: {
        applicationId,
        programId: programId(applicationId),
        teamId: null,
        requestedAt: NOW.toISOString(),
        collaboratorGithubLogins,
      },
      status: OutboxEventStatus.PENDING,
      availableAt: NOW,
    },
  });
}

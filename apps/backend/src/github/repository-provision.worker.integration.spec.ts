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
import { RepositoriesRepository } from './repository/repositories.repository';
import { RepositoryOutboxConsumer } from './repository-outbox.consumer';
import { REPOSITORY_PROVISION_EVENT_TYPE } from './repository-provision-event';
import { RepositoryProvisionJobRepository } from './repository/repository-provision-job.repository';
import { RepositoryProvisionStateRepository } from './repository/repository-provision-state.repository';
import { RepositoryProvisionWorker } from './repository-provision.worker';
import {
  DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
  DEFAULT_PROVISION_MAX_INVITATION_RECONCILIATIONS,
  PROVISION_ERROR_CODES,
} from './repository-provision.failure';

import { ConsentsRepository } from '../consents/consents.repository';
import { ConsentsService } from '../consents/consents.service';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { RepositoryOwnEnrollmentService } from './service/repository-own-enrollment.service';

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
const APPLICANT_GITHUB_ID = 8_300_000_000_001n;
const APPLICATION_IDS = [
  'synthetic-worker-success',
  'synthetic-worker-partial',
  'synthetic-worker-reconciliation-cap',
  'synthetic-worker-reconciliation-exhausted',
  'synthetic-worker-own-enrollment',
] as const;
const OWN_GITHUB_REPOSITORY_ID = 8_520_000_001n;
const OWN_NAME_WITH_OWNER = 'synthetic-student/synthetic-own-repo';
const OWN_REPOSITORY_URL = `https://github.com/${OWN_NAME_WITH_OWNER}`;

type ProvisionGithubClient = jest.Mocked<
  Pick<
    GithubAppClient,
    | 'findRepository'
    | 'createRepository'
    | 'ensureCollaborator'
    | 'findPublicRepository'
  >
>;

describe('RepositoryProvisionWorker integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: APPLICANT_ID,
        githubId: APPLICANT_GITHUB_ID,
        nickname: 'synthetic-worker-applicant',
        role: Role.STUDENT,
      },
    });
    // OWN 편입은 현재 동의를 요구한다 — 동의 없이 수집 행을 만들지 않는다.
    // 버전은 서비스가 알려주는 값을 쓴다. 상수를 복사하면 정책이 올라갈 때
    // 이 스펙만 조용히 옛 버전을 붙들고 통과한다.
    const { policy } = await new ConsentsService(
      new ConsentsRepository(prisma),
    ).getCurrent(APPLICANT_GITHUB_ID);
    await prisma.consent.create({
      data: {
        userId: APPLICANT_ID,
        policyVersion: policy.policyVersion,
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
    await prisma.githubRepository.deleteMany({
      where: { githubRepositoryId: OWN_GITHUB_REPOSITORY_ID },
    });
    await prisma.application.deleteMany({
      where: { id: { in: [...APPLICATION_IDS] } },
    });
    await prisma.teamMember.deleteMany({
      where: { id: { in: APPLICATION_IDS.map((id) => `${id}-team-member`) } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: APPLICATION_IDS.map(teamIdFor) } },
    });
    await prisma.program.deleteMany({
      where: { id: { in: APPLICATION_IDS.map(programId) } },
    });
  });

  afterAll(async () => {
    await prisma.consent.deleteMany({ where: { userId: APPLICANT_ID } });
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
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

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
    await prisma.repositoryInvitation.updateMany({
      where: {
        repositoryId: repository.id,
        githubLogin: 'synthetic-leader',
      },
      data: { attemptCount: 1 },
    });
    github.ensureCollaborator.mockResolvedValue(
      COLLABORATOR_OUTCOMES.SUCCEEDED,
    );

    const reconciliationAt = new Date(
      NOW.getTime() + DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
    );
    await worker.runNext('provision-worker-reconcile', reconciliationAt);

    await expect(
      prisma.repositoryInvitation.findFirstOrThrow({
        where: {
          repositoryId: repository.id,
          githubLogin: 'synthetic-leader',
        },
      }),
    ).resolves.toMatchObject({
      status: RepositoryInvitationStatus.SUCCEEDED,
      attemptCount: 1,
    });
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      attemptCount: 1,
    });
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
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });
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
  it('수락 대기 확인 상한에 도달한 invitation은 다시 claim하지 않는다', async () => {
    // Given: 발송 후 확인 상한에 도달한 PENDING invitation이 있다.
    const applicationId = APPLICATION_IDS[2];
    await createApplicationAndEvent(applicationId, ['synthetic-student']);
    await outbox.consumeNext('outbox-worker-cap', NOW);
    const github = githubClient();
    github.ensureCollaborator.mockResolvedValue(COLLABORATOR_OUTCOMES.PENDING);
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });
    await worker.runNext('provision-worker-cap-initial', NOW);
    const repository = await prisma.repository.findUniqueOrThrow({
      where: { applicationId },
    });
    await prisma.repositoryInvitation.updateMany({
      where: { repositoryId: repository.id },
      data: {
        reconciliationCount: DEFAULT_PROVISION_MAX_INVITATION_RECONCILIATIONS,
      },
    });

    // When: 다음 확인 시각에 worker를 실행한다.
    const result = await worker.runNext(
      'provision-worker-cap-reconcile',
      new Date(
        NOW.getTime() + DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
      ),
    );

    // Then: 상한 invitation은 다시 확인하지 않고 worker가 비어 있다.
    expect(result).toEqual({ kind: 'EMPTY' });
    expect(github.ensureCollaborator).toHaveBeenCalledTimes(1);
  });
  it('마지막 확인에서도 수락되지 않으면 invitation을 최종 실패로 종료한다', async () => {
    // Given: 확인 예산을 한 번 남긴 PENDING invitation이 있다.
    const applicationId = APPLICATION_IDS[3];
    await createApplicationAndEvent(applicationId, ['synthetic-student']);
    await outbox.consumeNext('outbox-worker-exhaust', NOW);
    const github = githubClient();
    github.ensureCollaborator.mockResolvedValue(COLLABORATOR_OUTCOMES.PENDING);
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });
    await worker.runNext('provision-worker-exhaust-initial', NOW);
    const repository = await prisma.repository.findUniqueOrThrow({
      where: { applicationId },
    });
    await prisma.repositoryInvitation.updateMany({
      where: { repositoryId: repository.id },
      data: {
        reconciliationCount:
          DEFAULT_PROVISION_MAX_INVITATION_RECONCILIATIONS - 1,
      },
    });

    // When: 마지막 확인을 수행한다(여전히 수락되지 않은 상태).
    await worker.runNext(
      'provision-worker-exhaust-reconcile',
      new Date(
        NOW.getTime() + DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
      ),
    );

    // Then: PENDING 으로 남지 않고 최종 실패로 종료한다.
    // 종료하지 않으면 학생 화면이 「초대 수락 대기」를 영구히 보여 준다.
    await expect(
      prisma.repositoryInvitation.findFirstOrThrow({
        where: { repositoryId: repository.id },
      }),
    ).resolves.toMatchObject({
      status: RepositoryInvitationStatus.FAILED_FINAL,
      reconciliationCount: DEFAULT_PROVISION_MAX_INVITATION_RECONCILIATIONS,
      lastErrorCode: PROVISION_ERROR_CODES.INVITATION_RECONCILIATION_EXHAUSTED,
    });
  });

  /**
   * OWN 편입은 프로덕션 표본이 0건이라 화면 대조로 잡히지 않는다 — 그래서
   * `nameWithOwner` 에 bare repo name 이 들어가도 배포까지 갔다. 편입은 되는데
   * external 스윕이 그 행에서 `throw` 하는 조용히 실패하는 경로였다.
   *
   * mock 이 아니라 실제 편입 서비스와 실 Postgres 로 값의 모양까지 고정한다
   * (ADR-010 §11 대체 acceptance).
   */
  it('OWN 승인이 owner/repo 와 실제 defaultBranch 로 수집 행을 만든다', async () => {
    // Given: OWN 으로 승인된 신청과 현재 동의가 있다.
    const applicationId = APPLICATION_IDS[4];
    await createApplicationAndEvent(applicationId, ['synthetic-student'], {
      connectionMode: 'OWN',
      repositoryUrl: OWN_REPOSITORY_URL,
    });
    // 소비 결과를 단언한다 — 여기서 조용히 EMPTY 가 나면 아래 실패의 원인이 안 보인다.
    await expect(
      outbox.consumeNext('outbox-worker-own', NOW),
    ).resolves.toMatchObject({ kind: 'CONSUMED' });
    const github = githubClient();
    github.findPublicRepository.mockResolvedValue({
      githubRepositoryId: OWN_GITHUB_REPOSITORY_ID,
      nameWithOwner: OWN_NAME_WITH_OWNER,
      defaultBranch: 'trunk',
      archived: false,
      // `name` 은 owner 없는 bare 이름이다 — 이 칸을 `nameWithOwner` 로 착각한
      // 것이 원래 결함이었으므로 값을 일부러 다르게 둔다.
      name: 'synthetic-own-repo',
      url: OWN_REPOSITORY_URL,
      visibility: RepositoryVisibility.PUBLIC,
      description: 'synthetic-own-description',
    });
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      ownEnrollment(),
    );

    // When: worker 가 OWN job 을 처리한다.
    const result = await worker.runNext('provision-worker-own', NOW);

    // Then: 수집 행이 external 스윕 계약을 만족하는 모양으로 남는다.
    expect(result.kind).toBe('SUCCEEDED');
    const enrolled = await prisma.githubRepository.findFirstOrThrow({
      where: { githubRepositoryId: OWN_GITHUB_REPOSITORY_ID },
    });
    expect(enrolled).toMatchObject({
      source: 'EXTERNAL_PUBLIC',
      nameWithOwner: OWN_NAME_WITH_OWNER,
      defaultBranch: 'trunk',
      presence: 'PRESENT',
      visibility: 'PUBLIC',
    });
    // `/` 가 없으면 스윕이 죽는다 — 값의 존재가 아니라 모양이 계약이다.
    expect(enrolled.nameWithOwner).toContain('/');
    // 신청 연결도 DB 로 증명된다 — 프로그램 화면의 노출 조건이다.
    await expect(
      prisma.repository.findUniqueOrThrow({ where: { applicationId } }),
    ).resolves.toMatchObject({
      githubRepositoryId: OWN_GITHUB_REPOSITORY_ID,
    });
  });
});

function programId(applicationId: string): string {
  return `${applicationId}-program`;
}

/**
 * 실제 편입 서비스를 실 Postgres 에 물린다.
 *
 * mock 을 주입하면 호출 여부만 볼 수 있고 저장된 값의 모양은 못 본다 —
 * 이 결함이 배포까지 간 이유가 정확히 그것이다.
 */
function ownEnrollment(): RepositoryOwnEnrollmentService {
  return new RepositoryOwnEnrollmentService(
    new ConsentsService(new ConsentsRepository(prisma)),
    new CollectionIncrementalRepository(prisma),
  );
}

function githubClient(): ProvisionGithubClient {
  return {
    findRepository: jest.fn().mockResolvedValue(null),
    createRepository: jest.fn((name: string, description: string) =>
      Promise.resolve(repositoryMetadata(name, description)),
    ),
    ensureCollaborator: jest
      .fn()
      .mockResolvedValue(COLLABORATOR_OUTCOMES.SUCCEEDED),
    findPublicRepository: jest.fn().mockResolvedValue(null),
  };
}

function repositoryMetadata(
  name: string,
  description: string,
): GithubRepositoryMetadata {
  return {
    githubRepositoryId: 987654321n,
    name,
    url: `https://github.com/synthetic-org/${name}`,
    visibility: RepositoryVisibility.PRIVATE,
    description,
  };
}

function teamIdFor(applicationId: string): string {
  return `${applicationId}-team`;
}

async function createApplicationAndEvent(
  applicationId: string,
  collaboratorGithubLogins: readonly string[],
  own?: { readonly connectionMode: 'OWN'; readonly repositoryUrl: string },
): Promise<void> {
  const program = programId(applicationId);
  const teamId = teamIdFor(applicationId);
  await prisma.program.create({
    data: {
      id: program,
      name: 'Synthetic Program',
      organizer: 'synthetic-organizer',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'synthetic-template',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      description: 'synthetic-description',
      repositoryProvisioningEnabled: true,
    },
  });
  await prisma.team.create({
    data: {
      id: teamId,
      programId: program,
      name: `${applicationId}-team`,
      joinCodeDigest: `${applicationId}-team-digest`,
      leaderId: APPLICANT_ID,
    },
  });
  await prisma.teamMember.create({
    data: {
      id: `${applicationId}-team-member`,
      teamId,
      programId: program,
      userId: APPLICANT_ID,
    },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId: program,
      applicantId: APPLICANT_ID,
      teamId,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
      ...(own === undefined
        ? {}
        : {
            repositoryConnectionMode: own.connectionMode,
            repositoryUrl: own.repositoryUrl,
          }),
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
        programId: program,
        // legacy outbox payload may still carry null teamId (worker accepts it).
        teamId: null,
        requestedAt: NOW.toISOString(),
        collaboratorGithubLogins,
        // OWN 여부는 outbox payload 가 원본이다 — Application 칸만 바꾸면
        // worker 는 여전히 NEW 로 처리한다.
        ...(own === undefined
          ? {}
          : {
              repositoryConnectionMode: own.connectionMode,
              repositoryUrl: own.repositoryUrl,
            }),
      },
      status: OutboxEventStatus.PENDING,
      availableAt: NOW,
    },
  });
}

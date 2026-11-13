import {
  deleteGithubRepositories,
  syncGithubRepositoryLedger,
} from '../../test/repo-ledger.fixture';
import { RepositoryDeletionRepository } from '../platform/repository-deletion.repository';
import { StudentRepositoryUrlContextRepository } from './team.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import { TeamHistoryRepository } from './team-history.repository';
import {
  TeamHistoryEvent,
  ApplicationStatus,
  ProgramCategory,
  RepositoryConnectionMode,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  ProgramTrackType,
} from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import {
  canonicalUserCreate,
  canonicalUserCreateFromLabel,
} from '../users/canonical-user-fixture';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { ApplicationsRepository } from './team.repository';
import { TeamApplicationService } from './team-application.service';
import { ApplicationsErrorCode } from './teams.error';
import { StudentRepositoryUrlRepository } from './team.repository';
import { StudentRepositoryUrlService } from './team-application.service';
import { OwnRepositoryUrlValidationService } from '../github/own-repository-url-validation.service';
import { UserPolicyRepository } from '../users/user-policy.repository';
import { ConsentsService } from '../users/consents.service';
import { PrismaService } from '../platform/prisma.service';
import type {
  GithubAppClient,
  GithubPublicRepositoryMetadata,
  GithubRepositoryMetadata,
} from '../github/github-app.client';
import { CollectionIncrementalRepository } from '../github/collection-incremental.repository';
import { RepositoriesRepository } from '../github/repositories.repository';
import { RepositoryProvisionJobRepository } from '../github/repository-provision-job.repository';
import { RepositoryProvisionStateRepository } from '../github/repository-provision-state.repository';
import { PROVISION_ERROR_CODES } from '../github/repository-provision-state.config';
import { RepositoryOutboxConsumerService } from '../github/repository-outbox-consumer.service';
import { RepositoryProvisionWorkerService } from '../github/repository-provision-worker.service';
import { RepositoryOwnEnrollmentService } from '../github/repositories.service';
import { RepositoryProvisionGithubService } from '../github/repository-provision-github.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { RepositoryProvisionEventService } from '../github/repository-provision-event.service';
import { ApplicationAnswersService } from './team-application.service';
import { RepositoryProvisionStateService } from '../github/repository-provision-state.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new ApplicationsRepository(
  prisma,
  new TeamHistoryRepository(),
  new RepositoryProvisionGenerationRepository(),
  new PlatformRepository(),
);
const service = new TeamApplicationService(
  repository,
  new RepositoryUrlService(),
  new ApplicationAnswersService(),
  new RepositoryProvisionEventService(),
);
const outbox = new RepositoryOutboxConsumerService(
  new RepositoriesRepository(
    prisma,
    new RepositoryProvisionGenerationRepository(),
  ),
  { runNext: () => Promise.reject(new Error('worker is not used here')) },
  new RepositoryProvisionEventService(),
);
const jobs = new RepositoryProvisionJobRepository(prisma);
const state = new RepositoryProvisionStateService(
  new RepositoryProvisionStateRepository(
    prisma,
    new RepositoryProvisionGenerationRepository(),
    new RepositoryProvisionJobRepository(prisma),
    new RepositoryDeletionRepository(),
  ),
  new RepositoryUrlService(),
  new RepositoryProvisionEventService(),
);

const STAFF_ACTOR_ID = 'synthetic-own-chain-staff';
const STAFF_GITHUB_ID = 8_400_000_000_001n;
const STUDENT_ACTOR_ID = 'synthetic-own-chain-student-actor';
const STUDENT_ACTOR_GITHUB_ID = 8_400_000_000_002n;
const APPLICANT_ID = 'synthetic-own-chain-applicant';
const APPLICANT_GITHUB_ID = 8_400_000_000_003n;
const NO_CONSENT_APPLICANT_ID = 'synthetic-own-chain-no-consent-applicant';
const NO_CONSENT_APPLICANT_GITHUB_ID = 8_400_000_000_004n;
const ORG_OWN_APPLICANT_ID = 'synthetic-own-chain-org-applicant';
const ORG_OWN_APPLICANT_GITHUB_ID = 8_400_000_000_005n;

const PRECHECK_APPLICANT_ID = 'synthetic-own-chain-precheck-applicant';
const PRECHECK_APPLICANT_GITHUB_ID = 8_400_000_000_006n;

const ORG_OWNER_EXTERNAL_APPLICANT_ID =
  'synthetic-own-chain-org-owner-external-applicant';
const ORG_OWNER_EXTERNAL_APPLICANT_GITHUB_ID = 8_400_000_000_007n;

const CHAIN_APPLICATION_ID = 'synthetic-own-chain-application';
const NO_CONSENT_APPLICATION_ID = 'synthetic-own-chain-no-consent-application';
const ORG_OWN_APPLICATION_ID = 'synthetic-own-chain-org-application';
const PRECHECK_MISSING_APPLICATION_ID =
  'synthetic-own-chain-precheck-missing-application';
const PRECHECK_PRIVATE_APPLICATION_ID =
  'synthetic-own-chain-precheck-private-application';
const ORG_OWNER_EXTERNAL_APPLICATION_ID =
  'synthetic-own-chain-org-owner-external-application';
const AUTHORITY_APPLICATION_ID = 'synthetic-own-chain-authority-application';
const AUTHORITY_DENIED_APPLICATION_ID =
  'synthetic-own-chain-authority-denied-application';
const NEW_LINKED_APPLICATION_ID = 'synthetic-own-chain-new-linked-application';
const APPLICATION_IDS = [
  CHAIN_APPLICATION_ID,
  NO_CONSENT_APPLICATION_ID,
  ORG_OWN_APPLICATION_ID,
  PRECHECK_MISSING_APPLICATION_ID,
  PRECHECK_PRIVATE_APPLICATION_ID,
  ORG_OWNER_EXTERNAL_APPLICATION_ID,
  AUTHORITY_APPLICATION_ID,
  AUTHORITY_DENIED_APPLICATION_ID,
  NEW_LINKED_APPLICATION_ID,
] as const;

const OWN_GITHUB_REPOSITORY_ID = 8_520_100_001n;
const OWN_NAME_WITH_OWNER =
  'synthetic-own-chain-student/synthetic-own-chain-repo';
const OWN_REPOSITORY_URL = `https://github.com/${OWN_NAME_WITH_OWNER}`;

const NO_CONSENT_GITHUB_REPOSITORY_ID = 8_520_100_002n;
const NO_CONSENT_NAME_WITH_OWNER =
  'synthetic-own-chain-student/synthetic-own-chain-no-consent-repo';

const ORG_OWN_ORGANIZATION = 'synthetic-own-chain-org';
const ORG_GITHUB_REPOSITORY_ID = 8_520_100_003n;
const ORG_OWN_NAME_WITH_OWNER = `${ORG_OWN_ORGANIZATION}/synthetic-own-chain-org-repo`;

const ECONOVATION_ORGANIZATION = 'JNU-econovation';
const ECONOVATION_GITHUB_REPOSITORY_ID = 8_520_100_004n;
const ECONOVATION_NAME_WITH_OWNER = `${ECONOVATION_ORGANIZATION}/eco-knock-be-central`;

const PREVIOUS_GITHUB_REPOSITORY_ID = 8_520_100_005n;
const PREVIOUS_NAME_WITH_OWNER =
  'synthetic-own-chain-student/synthetic-own-chain-previous-repo';

type ProvisionGithubClient = jest.Mocked<
  Pick<
    GithubAppClient,
    | 'findRepository'
    | 'createRepository'
    | 'ensureCollaborator'
    | 'revokeCollaborator'
    | 'findPublicRepository'
    | 'organization'
  >
>;

async function consumeUntilProvisionEvent(
  eventId: string | null,
  workerId: string,
) {
  if (eventId === null) {
    throw new Error('fixture approval must create a provision event');
  }
  for (let offset = 0; offset < 100; offset += 1) {
    const result = await outbox.consumeNext(
      workerId,
      new Date(Date.now() + offset),
    );
    if (result.kind === 'EMPTY') {
      throw new Error(`provision event ${eventId} was not claimable`);
    }
    if (result.eventId === eventId) {
      const event = await prisma.outboxEvent.findUniqueOrThrow({
        where: { id: eventId },
        select: { availableAt: true },
      });
      if (event.availableAt == null) {
        throw new Error(`provision event ${eventId} has no availableAt`);
      }
      return { ...result, queueNow: event.availableAt };
    }
  }
  throw new Error(`provision event ${eventId} was not consumed`);
}

describe('OWN 저장소 연결·생성 사슬 통합', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        ...canonicalUserCreate({
          id: STAFF_ACTOR_ID,
          githubId: STAFF_GITHUB_ID,
          nickname: 'synthetic-own-chain-staff',
          memberKind: MemberKind.STAFF,
          hasStaffAccess: true,
          name: 'Synthetic Own Chain Staff',
          department: 'Synthetic Program Office',
        }),
        approvalStatus: 'APPROVED',
        approvalRequestId: `${STAFF_ACTOR_ID}:access`,
        approvalRequestedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await Promise.all(
      (
        [
          [
            STUDENT_ACTOR_ID,
            STUDENT_ACTOR_GITHUB_ID,
            'synthetic-own-chain-student-actor',
          ],
          [APPLICANT_ID, APPLICANT_GITHUB_ID, 'synthetic-own-chain-applicant'],
          [
            NO_CONSENT_APPLICANT_ID,
            NO_CONSENT_APPLICANT_GITHUB_ID,
            'synthetic-own-chain-no-consent',
          ],
          [
            ORG_OWN_APPLICANT_ID,
            ORG_OWN_APPLICANT_GITHUB_ID,
            'synthetic-own-chain-org-applicant',
          ],
          [
            PRECHECK_APPLICANT_ID,
            PRECHECK_APPLICANT_GITHUB_ID,
            'synthetic-own-chain-precheck-applicant',
          ],
          [
            ORG_OWNER_EXTERNAL_APPLICANT_ID,
            ORG_OWNER_EXTERNAL_APPLICANT_GITHUB_ID,
            'synthetic-own-chain-org-owner-external',
          ],
        ] as const
      ).map(([id, githubId, nickname]) =>
        prisma.user.create({
          data: canonicalUserCreateFromLabel('STUDENT', {
            id,
            githubId,
            nickname,
          }),
        }),
      ),
    );

    const { policy } = await new ConsentsService(
      new UserPolicyRepository(prisma),
    ).getCurrent(APPLICANT_GITHUB_ID);
    await prisma.userPolicy.create({
      data: { userId: APPLICANT_ID, policyVersion: policy.policyVersion },
    });
    await prisma.userPolicy.create({
      data: {
        userId: ORG_OWNER_EXTERNAL_APPLICANT_ID,
        policyVersion: policy.policyVersion,
      },
    });
  });

  afterEach(async () => {
    await prisma.repositoryInvitation.deleteMany({
      where: {
        OR: [
          { repository: { teamId: { in: [...APPLICATION_IDS] } } },
          {
            repository: {
              githubRepositoryId: {
                in: [
                  OWN_GITHUB_REPOSITORY_ID,
                  NO_CONSENT_GITHUB_REPOSITORY_ID,
                  ORG_GITHUB_REPOSITORY_ID,
                  ECONOVATION_GITHUB_REPOSITORY_ID,
                ],
              },
            },
          },
        ],
      },
    });
    await deleteGithubRepositories(
      prisma,
      {
        OR: [
          { teamId: { in: [...APPLICATION_IDS] } },
          {
            githubRepositoryId: {
              in: [
                OWN_GITHUB_REPOSITORY_ID,
                NO_CONSENT_GITHUB_REPOSITORY_ID,
                ORG_GITHUB_REPOSITORY_ID,
                ECONOVATION_GITHUB_REPOSITORY_ID,
                PREVIOUS_GITHUB_REPOSITORY_ID,
              ],
            },
          },
        ],
      },
      APPLICATION_IDS,
    );
    await prisma.repositoryProvisionJob.deleteMany({
      where: { teamId: { in: [...APPLICATION_IDS] } },
    });

    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.repositoryIssuanceHistory.deleteMany({
      where: { teamId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.notification.deleteMany({
      where: { type: 'APPLICATION_DECISION' },
    });
    await prisma.teamMember.deleteMany({
      where: { teamId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [...APPLICATION_IDS] } },
    });
    await prisma.program.deleteMany({
      where: { id: { in: APPLICATION_IDS.map(programIdFor) } },
    });
  });

  afterAll(async () => {
    await prisma.userPolicy.deleteMany({
      where: {
        userId: { in: [APPLICANT_ID, ORG_OWNER_EXTERNAL_APPLICANT_ID] },
      },
    });

    await prisma.$disconnect();
  });

  describe('TeamApplicationService 판정 권한', () => {
    it('실 DB의 STAFF 세션을 허용하고 해석한 처리자 ID를 판정·감사 이력에 남긴다', async () => {
      await createOwnApplication(AUTHORITY_APPLICATION_ID, APPLICANT_ID, {
        githubRepositoryId: OWN_GITHUB_REPOSITORY_ID,
        nameWithOwner: OWN_NAME_WITH_OWNER,
      });

      const decision = await service.decide(
        { id: STAFF_ACTOR_ID, githubId: STAFF_GITHUB_ID },
        AUTHORITY_APPLICATION_ID,
        { action: 'APPROVE' },
      );

      expect(decision.kind).toBe('APPROVED');
      await expect(
        prisma.team.findUniqueOrThrow({
          where: { id: AUTHORITY_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({
        status: ApplicationStatus.APPROVED,
        processedById: STAFF_ACTOR_ID,
      });
      await expect(
        prisma.teamHistory.findFirstOrThrow({
          where: { teamId: AUTHORITY_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({
        event: TeamHistoryEvent.APPROVED,
        actorId: STAFF_ACTOR_ID,
      });
      await expect(
        prisma.teamHistory.count({
          where: { teamId: AUTHORITY_APPLICATION_ID },
        }),
      ).resolves.toBe(1);
    });

    it('저장소 행이 없는 OWN 팀은 승인하지 않고 OWN_REPOSITORY_URL_REQUIRED로 막는다', async () => {
      await createOwnApplication(AUTHORITY_APPLICATION_ID, APPLICANT_ID, null);

      await expect(
        service.decide(
          { id: STAFF_ACTOR_ID, githubId: STAFF_GITHUB_ID },
          AUTHORITY_APPLICATION_ID,
          { action: 'APPROVE' },
        ),
      ).rejects.toMatchObject({
        errorCode: { code: ApplicationsErrorCode.OWN_REPOSITORY_URL_REQUIRED },
      });
      await expect(
        prisma.team.findUniqueOrThrow({
          where: { id: AUTHORITY_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({ processedById: null });
      await expect(
        prisma.outboxEvent.count({
          where: { aggregateId: AUTHORITY_APPLICATION_ID },
        }),
      ).resolves.toBe(0);
    });

    it('저장소 행이 붙은 NEW 팀을 승인해도 발급 이벤트에 저장소 주소를 싣지 않아 되돌릴 수 있다', async () => {
      await createOwnApplication(NEW_LINKED_APPLICATION_ID, APPLICANT_ID, {
        githubRepositoryId: OWN_GITHUB_REPOSITORY_ID,
        nameWithOwner: OWN_NAME_WITH_OWNER,
      });
      await prisma.team.update({
        where: { id: NEW_LINKED_APPLICATION_ID },
        data: { repositoryConnectionMode: RepositoryConnectionMode.NEW },
      });
      const staff = { id: STAFF_ACTOR_ID, githubId: STAFF_GITHUB_ID };

      await expect(
        service.decide(staff, NEW_LINKED_APPLICATION_ID, { action: 'APPROVE' }),
      ).resolves.toMatchObject({ kind: 'APPROVED' });
      const approvalEvent = await prisma.outboxEvent.findFirstOrThrow({
        where: {
          idempotencyKey: `repository-provision:${NEW_LINKED_APPLICATION_ID}`,
        },
      });
      expect(approvalEvent).toMatchObject({
        payload: { repositoryConnectionMode: 'NEW', repositoryUrl: null },
      });

      await expect(
        service.decide(staff, NEW_LINKED_APPLICATION_ID, { action: 'REVERT' }),
      ).resolves.toMatchObject({ kind: 'REVERTED' });
      await expect(
        prisma.outboxEvent.count({
          where: { aggregateId: NEW_LINKED_APPLICATION_ID },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.repositoryIssuanceHistory.findMany({
          where: { teamId: NEW_LINKED_APPLICATION_ID },
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          requestId: approvalEvent.id,
          connectionMode: RepositoryConnectionMode.NEW,
          outcome: RepositoryIssuanceOutcome.DISCARDED,
        }),
      ]);
      await expect(
        prisma.team.findUniqueOrThrow({
          where: { id: NEW_LINKED_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({ status: ApplicationStatus.SUBMITTED });
    });
  });

  it(
    '권한 확인→승인 판정→outbox 소비→worker 편입까지 실 DB로 완주해 ' +
      'owner/repo와 defaultBranch를 가진 수집 행을 남긴다',
    async () => {
      await createOwnApplication(CHAIN_APPLICATION_ID, APPLICANT_ID, {
        githubRepositoryId: OWN_GITHUB_REPOSITORY_ID,
        nameWithOwner: OWN_NAME_WITH_OWNER,
      });

      const decision = await service.decide(
        { id: STAFF_ACTOR_ID, githubId: STAFF_GITHUB_ID },
        CHAIN_APPLICATION_ID,
        { action: 'APPROVE' },
      );

      expect(decision.kind).toBe('APPROVED');
      if (decision.kind !== 'APPROVED') {
        throw new Error('fixture approval must succeed');
      }
      await expect(
        prisma.team.findUniqueOrThrow({
          where: { id: CHAIN_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({ processedById: STAFF_ACTOR_ID });
      await expect(
        prisma.outboxEvent.findUniqueOrThrow({
          where: {
            idempotencyKey: `repository-provision:${CHAIN_APPLICATION_ID}`,
          },
        }),
      ).resolves.toMatchObject({ status: 'PENDING' });

      const consumed = await consumeUntilProvisionEvent(
        decision.repositoryProvisioning.eventId,
        'own-chain-outbox-worker',
      );
      expect(consumed).toMatchObject({ kind: 'CONSUMED' });
      const queueNow = consumed.queueNow;

      const github = githubClient();
      github.findPublicRepository.mockResolvedValue(
        ownRepositoryMetadata(OWN_GITHUB_REPOSITORY_ID, OWN_NAME_WITH_OWNER),
      );
      const worker = new RepositoryProvisionWorkerService(
        jobs,
        state,
        github as unknown as GithubAppClient,
        ownEnrollment(),
        new RepositoryProvisionGithubService(new RepositoryUrlService()),
      );
      const result = await worker.runNext(
        'own-chain-provision-worker',
        queueNow,
      );

      expect(result.kind).toBe('SUCCEEDED');
      await expect(
        prisma.githubRepository.findFirstOrThrow({
          where: { githubRepositoryId: OWN_GITHUB_REPOSITORY_ID },
        }),
      ).resolves.toMatchObject({
        source: 'EXTERNAL_PUBLIC',
        nameWithOwner: OWN_NAME_WITH_OWNER,
        defaultBranch: 'main',
        presence: 'PRESENT',
      });

      await expect(
        prisma.githubRepository.findUniqueOrThrow({
          where: { teamId: CHAIN_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({
        githubRepositoryId: OWN_GITHUB_REPOSITORY_ID,
      });
      await expect(
        prisma.repositoryProvisionJob.findUniqueOrThrow({
          where: { teamId: CHAIN_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      });
    },
  );

  it(
    'Econovation식 외부 ORGANIZATION이 소유한 공개 repo(신청자 개인 계정과 다른 owner)로 ' +
      'OWN 지원 → 승인 → worker 편입까지 완주해 EXTERNAL_PUBLIC 행을 남긴다',
    async () => {
      await createOwnApplication(
        ORG_OWNER_EXTERNAL_APPLICATION_ID,
        ORG_OWNER_EXTERNAL_APPLICANT_ID,
        {
          githubRepositoryId: ECONOVATION_GITHUB_REPOSITORY_ID,
          nameWithOwner: ECONOVATION_NAME_WITH_OWNER,
        },
      );

      const decision = await service.decide(
        { id: STAFF_ACTOR_ID, githubId: STAFF_GITHUB_ID },
        ORG_OWNER_EXTERNAL_APPLICATION_ID,
        { action: 'APPROVE' },
      );
      expect(decision.kind).toBe('APPROVED');
      if (decision.kind !== 'APPROVED') {
        throw new Error('fixture approval must succeed');
      }

      const consumed = await consumeUntilProvisionEvent(
        decision.repositoryProvisioning.eventId,
        'own-chain-org-owner-external-outbox-worker',
      );
      expect(consumed).toMatchObject({ kind: 'CONSUMED' });
      const queueNow = consumed.queueNow;

      const github = githubClient();
      github.findPublicRepository.mockResolvedValue(
        ownRepositoryMetadata(
          ECONOVATION_GITHUB_REPOSITORY_ID,
          ECONOVATION_NAME_WITH_OWNER,
        ),
      );
      const worker = new RepositoryProvisionWorkerService(
        jobs,
        state,
        github as unknown as GithubAppClient,
        ownEnrollment(),
        new RepositoryProvisionGithubService(new RepositoryUrlService()),
      );
      const result = await worker.runNext(
        'own-chain-org-owner-external-provision-worker',
        queueNow,
      );

      expect(result.kind).toBe('SUCCEEDED');
      expect(github.findRepository).not.toHaveBeenCalled();
      expect(github.findPublicRepository).toHaveBeenCalledWith(
        ECONOVATION_ORGANIZATION,
        'eco-knock-be-central',
      );
      await expect(
        prisma.githubRepository.findFirstOrThrow({
          where: { githubRepositoryId: ECONOVATION_GITHUB_REPOSITORY_ID },
        }),
      ).resolves.toMatchObject({
        source: 'EXTERNAL_PUBLIC',
        nameWithOwner: ECONOVATION_NAME_WITH_OWNER,
        defaultBranch: 'main',
        presence: 'PRESENT',
        teamId: ORG_OWNER_EXTERNAL_APPLICATION_ID,
      });
      await expect(
        prisma.repositoryProvisionJob.findUniqueOrThrow({
          where: { teamId: ORG_OWNER_EXTERNAL_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      });
    },
  );

  it('현재 동의가 없으면 job은 재시도 가능 실패로 끝나고 수집 관찰 필드는 채워지지 않는다', async () => {
    await createOwnApplication(
      NO_CONSENT_APPLICATION_ID,
      NO_CONSENT_APPLICANT_ID,
      {
        githubRepositoryId: NO_CONSENT_GITHUB_REPOSITORY_ID,
        nameWithOwner: NO_CONSENT_NAME_WITH_OWNER,
      },
    );
    const decision = await service.decide(
      { id: STAFF_ACTOR_ID, githubId: STAFF_GITHUB_ID },
      NO_CONSENT_APPLICATION_ID,
      { action: 'APPROVE' },
    );
    if (decision.kind !== 'APPROVED') {
      throw new Error('fixture approval must succeed');
    }
    const consumed = await consumeUntilProvisionEvent(
      decision.repositoryProvisioning.eventId,
      'own-chain-no-consent-outbox-worker',
    );
    expect(consumed).toMatchObject({ kind: 'CONSUMED' });
    const queueNow = consumed.queueNow;
    const github = githubClient();
    github.findPublicRepository.mockResolvedValue(
      ownRepositoryMetadata(
        NO_CONSENT_GITHUB_REPOSITORY_ID,
        NO_CONSENT_NAME_WITH_OWNER,
      ),
    );
    const worker = new RepositoryProvisionWorkerService(
      jobs,
      state,
      github as unknown as GithubAppClient,
      ownEnrollment(),
      new RepositoryProvisionGithubService(new RepositoryUrlService()),
    );

    const result = await worker.runNext(
      'own-chain-no-consent-provision-worker',
      queueNow,
    );

    expect(result.kind).toBe('FAILED_RETRYABLE');
    await expect(
      prisma.githubRepository.findFirstOrThrow({
        where: { githubRepositoryId: NO_CONSENT_GITHUB_REPOSITORY_ID },
      }),
    ).resolves.toMatchObject({
      teamId: NO_CONSENT_APPLICATION_ID,
      source: 'EXTERNAL_PUBLIC',
      defaultBranch: null,
      lastSuccessAt: null,
    });
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { teamId: NO_CONSENT_APPLICATION_ID },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.FAILED_RETRYABLE,
    });
  });

  it(
    'OWN+ORGANIZATION 연결이 이미 채택한 ORG_PROVISIONED 저장소를 승인 뒤 ' +
      'worker가 같은 행으로 다시 기록해 성공한다(#617 단계 D 회귀 — ' +
      'recordRepository가 teamId 기준으로만 upsert하면 githubRepositoryId ' +
      'unique 제약과 충돌해 항상 실패했다)',
    async () => {
      await createOwnApplication(ORG_OWN_APPLICATION_ID, ORG_OWN_APPLICANT_ID, {
        githubRepositoryId: ORG_GITHUB_REPOSITORY_ID,
        nameWithOwner: ORG_OWN_NAME_WITH_OWNER,
        source: RepositorySource.ORG_PROVISIONED,
        visibility: RepositoryVisibility.PRIVATE,
      });
      const decision = await service.decide(
        { id: STAFF_ACTOR_ID, githubId: STAFF_GITHUB_ID },
        ORG_OWN_APPLICATION_ID,
        { action: 'APPROVE' },
      );
      if (decision.kind !== 'APPROVED') {
        throw new Error('fixture approval must succeed');
      }
      const consumed = await consumeUntilProvisionEvent(
        decision.repositoryProvisioning.eventId,
        'own-chain-org-outbox-worker',
      );
      expect(consumed).toMatchObject({ kind: 'CONSUMED' });
      const queueNow = consumed.queueNow;

      const github = githubClient();
      github.findRepository.mockResolvedValue(
        orgRepositoryMetadata(
          ORG_GITHUB_REPOSITORY_ID,
          ORG_OWN_NAME_WITH_OWNER,
        ),
      );
      const worker = new RepositoryProvisionWorkerService(
        jobs,
        state,
        github as unknown as GithubAppClient,
        ownEnrollment(),
        new RepositoryProvisionGithubService(new RepositoryUrlService()),
      );
      const result = await worker.runNext(
        'own-chain-org-provision-worker',
        queueNow,
      );

      expect(result.kind).toBe('SUCCEEDED');
      await expect(
        prisma.githubRepository.findUniqueOrThrow({
          where: { githubRepositoryId: ORG_GITHUB_REPOSITORY_ID },
        }),
      ).resolves.toMatchObject({
        teamId: ORG_OWN_APPLICATION_ID,
        source: 'ORG_PROVISIONED',
        presence: 'PRESENT',
      });
      await expect(
        prisma.repositoryProvisionJob.findUniqueOrThrow({
          where: { teamId: ORG_OWN_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      });
    },
  );
  it('keeps the relinked binding when an earlier approval outbox is consumed later', async () => {
    await createOwnApplication(CHAIN_APPLICATION_ID, APPLICANT_ID, {
      githubRepositoryId: PREVIOUS_GITHUB_REPOSITORY_ID,
      nameWithOwner: PREVIOUS_NAME_WITH_OWNER,
    });
    await service.decide(
      { id: STAFF_ACTOR_ID, githubId: STAFF_GITHUB_ID },
      CHAIN_APPLICATION_ID,
      {
        action: 'APPROVE',
      },
    );
    const github = githubClient();
    github.findPublicRepository.mockResolvedValue(
      ownRepositoryMetadata(OWN_GITHUB_REPOSITORY_ID, OWN_NAME_WITH_OWNER),
    );
    const relink = new StudentRepositoryUrlService(
      new StudentRepositoryUrlRepository(
        prisma,
        new PlatformRepository(),
        new StudentRepositoryUrlContextRepository(new PlatformRepository()),
        new RepositoryProvisionGenerationRepository(),
        new RepositoryDeletionRepository(),
      ),
      repository,
      new OwnRepositoryUrlValidationService(
        github as unknown as GithubAppClient,
        new RepositoryProvisionGithubService(new RepositoryUrlService()),
      ),
      new ConsentsService(new UserPolicyRepository(prisma)),
      { collectRepository: jest.fn() },
      new RepositoryProvisionEventService(),
    );
    await relink.updateMine(
      APPLICANT_GITHUB_ID,
      programIdFor(CHAIN_APPLICATION_ID),
      { repositoryUrl: OWN_REPOSITORY_URL },
    );
    const current = await prisma.githubRepository.findUniqueOrThrow({
      where: { teamId: CHAIN_APPLICATION_ID },
    });
    const queueNow = await consumeApproval(
      CHAIN_APPLICATION_ID,
      'synthetic-late-outbox',
    );

    await new RepositoryProvisionWorkerService(
      jobs,
      state,
      github as unknown as GithubAppClient,
      ownEnrollment(),
      new RepositoryProvisionGithubService(new RepositoryUrlService()),
    ).runNext('synthetic-late-worker', queueNow);
    await expect(
      prisma.githubRepository.findUniqueOrThrow({
        where: { teamId: CHAIN_APPLICATION_ID },
      }),
    ).resolves.toMatchObject({ id: current.id });
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { teamId: CHAIN_APPLICATION_ID },
      }),
    ).resolves.toMatchObject({ repositoryId: current.id });
  });

  it.each([
    [PRECHECK_MISSING_APPLICATION_ID, null],
    [
      PRECHECK_PRIVATE_APPLICATION_ID,
      {
        ...ownRepositoryMetadata(8_520_100_099n, 'synthetic/private'),
        visibility: RepositoryVisibility.PRIVATE,
      },
    ],
  ])(
    'rejects unavailable OWN repository %s during provisioning without touching the stored row',
    async (teamId, metadata) => {
      await createOwnApplication(teamId, PRECHECK_APPLICANT_ID, {
        githubRepositoryId: 8_520_100_099n,
        nameWithOwner: 'synthetic/private',
      });
      await service.decide(
        { id: STAFF_ACTOR_ID, githubId: STAFF_GITHUB_ID },
        teamId,
        {
          action: 'APPROVE',
        },
      );
      const queueNow = await consumeApproval(teamId, 'synthetic-legacy-outbox');
      const github = githubClient();
      github.findPublicRepository.mockResolvedValue(metadata);
      const result = await new RepositoryProvisionWorkerService(
        jobs,
        state,
        github as unknown as GithubAppClient,
        ownEnrollment(),
        new RepositoryProvisionGithubService(new RepositoryUrlService()),
      ).runNext('synthetic-legacy-provision', queueNow);
      expect(result).toMatchObject({
        kind: 'FAILED_FINAL',
        errorCode: PROVISION_ERROR_CODES.OWN_REPOSITORY_NOT_FOUND,
      });
      await expect(
        prisma.githubRepository.findMany({ where: { teamId } }),
      ).resolves.toEqual([
        expect.objectContaining({
          githubRepositoryId: 8_520_100_099n,
          nameWithOwner: 'synthetic/private',
          visibility: RepositoryVisibility.PUBLIC,
          source: RepositorySource.EXTERNAL_PUBLIC,
        }),
      ]);
    },
  );
});

function programIdFor(teamId: string): string {
  return `${teamId}-program`;
}

async function consumeApproval(
  teamId: string,
  workerId: string,
): Promise<Date> {
  const event = await prisma.outboxEvent.findUniqueOrThrow({
    where: { idempotencyKey: `repository-provision:${teamId}` },
    select: { id: true, availableAt: true },
  });

  await expect(
    outbox.consumeNext(workerId, event.availableAt),
  ).resolves.toMatchObject({
    kind: 'CONSUMED',
    eventId: event.id,
  });
  return event.availableAt;
}

async function createOwnApplication(
  teamId: string,
  applicantId: string,
  repository: {
    readonly githubRepositoryId: bigint;
    readonly nameWithOwner: string;
    readonly source?: RepositorySource;
    readonly visibility?: RepositoryVisibility;
  } | null,
): Promise<void> {
  const programId = programIdFor(teamId);
  await prisma.program.create({
    data: {
      startAt: new Date('2026-01-01T00:00:00.000Z'),
      endAt: new Date(
        new Date('2026-12-31T00:00:00.000Z').getTime() + 365 * 86400000,
      ),
      id: programId,
      name: `program-${teamId}`,
      organizer: 'synthetic-organizer',
      trackType: ProgramTrackType.EXTRACURRICULAR,
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
      programId,
      name: `team-${teamId}`,
      leaderId: applicantId,
      applicantId: applicantId,
      answers: { title: `team-${teamId}` },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.teamMember.create({
    data: {
      teamId,
      programId,
      userId: applicantId,
    },
  });
  await prisma.team.update({
    where: { id: teamId },
    data: {
      programId,
      applicantId,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      repositoryConnectionMode: RepositoryConnectionMode.OWN,
    },
  });
  if (repository !== null) {
    await prisma.githubRepository.create({
      data: {
        teamId,
        githubRepositoryId: repository.githubRepositoryId,
        nameWithOwner: repository.nameWithOwner,
        defaultBranch: null,
        archived: false,
        visibility: repository.visibility ?? RepositoryVisibility.PUBLIC,
        source: repository.source ?? RepositorySource.EXTERNAL_PUBLIC,
        presence: 'PRESENT',
      },
    });
    await syncGithubRepositoryLedger(prisma, repository.githubRepositoryId);
  }
}

function ownEnrollment(): RepositoryOwnEnrollmentService {
  return new RepositoryOwnEnrollmentService(
    new ConsentsService(new UserPolicyRepository(prisma)),
    new CollectionIncrementalRepository(prisma, new PlatformRepository()),
  );
}

function githubClient(): ProvisionGithubClient {
  return {
    findRepository: jest.fn().mockResolvedValue(null),
    createRepository: jest.fn(),
    ensureCollaborator: jest.fn(),
    revokeCollaborator: jest.fn(),
    findPublicRepository: jest.fn().mockResolvedValue(null),
    organization: 'synthetic-own-chain-org',
  };
}

function ownRepositoryMetadata(
  githubRepositoryId: bigint,
  nameWithOwner: string,
): GithubPublicRepositoryMetadata {
  return {
    githubRepositoryId,
    nameWithOwner,
    defaultBranch: 'main',
    archived: false,
    name: nameWithOwner.split('/')[1] ?? nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
    visibility: RepositoryVisibility.PUBLIC,
    description: 'synthetic-own-chain-description',
  };
}

function orgRepositoryMetadata(
  githubRepositoryId: bigint,
  nameWithOwner: string,
): GithubRepositoryMetadata {
  return {
    githubRepositoryId,
    nameWithOwner,
    name: nameWithOwner.split('/')[1] ?? nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
    visibility: RepositoryVisibility.PRIVATE,
    description: 'synthetic-own-chain-org-description',
  };
}

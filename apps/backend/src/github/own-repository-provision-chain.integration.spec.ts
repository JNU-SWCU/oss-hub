import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import {
  MemberKind,
  ProgramCategory,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  StaffAccessRequestStatus,
  ProgramTrackType,
} from '@prisma/client';
import {
  canonicalUserCreate,
  canonicalUserCreateFromLabel,
} from '../users/canonical-user-fixture';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { ApplicationsErrorCode } from '../applications/applications-error-code.enum';
import { ApplicationsStaffGuard } from '../applications/applications-staff.guard';
import { ApplicationsRepository } from '../applications/applications.repository';
import { ApplicationsService } from '../applications/applications.service';
import { StudentRepositoryUrlRepository } from '../applications/student-repository-url.repository';
import { StudentRepositoryUrlService } from '../applications/student-repository-url.service';
import { OwnRepositoryUrlValidationService } from './service/own-repository-url-validation.service';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ConsentsRepository } from '../consents/consents.repository';
import { ConsentsService } from '../consents/consents.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  GithubAppClient,
  GithubPublicRepositoryMetadata,
  GithubRepositoryMetadata,
} from './github-app.client';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { RepositoriesRepository } from './repository/repositories.repository';
import { RepositoryProvisionJobRepository } from './repository/repository-provision-job.repository';
import { RepositoryProvisionStateRepository } from './repository/repository-provision-state.repository';
import { RepositoryOutboxConsumer } from './repository-outbox.consumer';
import { RepositoryProvisionWorker } from './repository-provision.worker';
import { PROVISION_ERROR_CODES } from './repository-provision.failure';
import { RepositoryOwnEnrollmentService } from './service/repository-own-enrollment.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new ApplicationsRepository(prisma, {
  TEAM_JOIN_CODE_SECRET: 'synthetic-own-provision-chain-secret',
});
const service = new ApplicationsService(
  repository,
  new AuditLogService(new AuditLogRepository(prisma)),
);
const staffGuard = new ApplicationsStaffGuard(prisma);
const outbox = new RepositoryOutboxConsumer(new RepositoriesRepository(prisma));
const jobs = new RepositoryProvisionJobRepository(prisma);
const state = new RepositoryProvisionStateRepository(prisma);

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
const APPLICATION_IDS = [
  CHAIN_APPLICATION_ID,
  NO_CONSENT_APPLICATION_ID,
  ORG_OWN_APPLICATION_ID,
  PRECHECK_MISSING_APPLICATION_ID,
  PRECHECK_PRIVATE_APPLICATION_ID,
  ORG_OWNER_EXTERNAL_APPLICATION_ID,
] as const;

const OWN_GITHUB_REPOSITORY_ID = 8_520_100_001n;
const OWN_NAME_WITH_OWNER =
  'synthetic-own-chain-student/synthetic-own-chain-repo';
const OWN_REPOSITORY_URL = `https://github.com/${OWN_NAME_WITH_OWNER}`;

const NO_CONSENT_GITHUB_REPOSITORY_ID = 8_520_100_002n;
const NO_CONSENT_NAME_WITH_OWNER =
  'synthetic-own-chain-student/synthetic-own-chain-no-consent-repo';
const NO_CONSENT_REPOSITORY_URL = `https://github.com/${NO_CONSENT_NAME_WITH_OWNER}`;

const ORG_OWN_ORGANIZATION = 'synthetic-own-chain-org';
const ORG_GITHUB_REPOSITORY_ID = 8_520_100_003n;
const ORG_OWN_NAME_WITH_OWNER = `${ORG_OWN_ORGANIZATION}/synthetic-own-chain-org-repo`;
const ORG_OWN_REPOSITORY_URL = `https://github.com/${ORG_OWN_NAME_WITH_OWNER}`;

const ECONOVATION_ORGANIZATION = 'JNU-econovation';
const ECONOVATION_GITHUB_REPOSITORY_ID = 8_520_100_004n;
const ECONOVATION_NAME_WITH_OWNER = `${ECONOVATION_ORGANIZATION}/eco-knock-be-central`;
const ECONOVATION_REPOSITORY_URL = `https://github.com/${ECONOVATION_NAME_WITH_OWNER}`;

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
        staffAccessRequests: {
          create: {
            id: `${STAFF_ACTOR_ID}:access`,
            status: StaffAccessRequestStatus.APPROVED,
          },
        },
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
      new ConsentsRepository(prisma),
    ).getCurrent(APPLICANT_GITHUB_ID);
    await prisma.consent.create({
      data: { userId: APPLICANT_ID, policyVersion: policy.policyVersion },
    });
    await prisma.consent.create({
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
          { repository: { applicationId: { in: [...APPLICATION_IDS] } } },
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
    await prisma.githubRepository.deleteMany({
      where: {
        githubRepositoryId: {
          in: [
            OWN_GITHUB_REPOSITORY_ID,
            NO_CONSENT_GITHUB_REPOSITORY_ID,
            ORG_GITHUB_REPOSITORY_ID,
            ECONOVATION_GITHUB_REPOSITORY_ID,
          ],
        },
      },
    });
    await prisma.repositoryProvisionJob.deleteMany({
      where: { applicationId: { in: [...APPLICATION_IDS] } },
    });

    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.notification.deleteMany({
      where: { type: 'APPLICATION_DECISION' },
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
      where: { id: { in: APPLICATION_IDS.map(programIdFor) } },
    });
  });

  afterAll(async () => {
    await prisma.consent.deleteMany({
      where: {
        userId: { in: [APPLICANT_ID, ORG_OWNER_EXTERNAL_APPLICANT_ID] },
      },
    });

    await prisma.$disconnect();
  });

  describe('ApplicationsStaffGuard', () => {
    it('실 DB의 STAFF actor를 허용하고 처리자 ID를 붙인다', async () => {
      const request: { sessionGithubId: bigint; applicationActorId?: string } =
        { sessionGithubId: STAFF_GITHUB_ID };
      const context = new ExecutionContextHost([request]);
      context.setType('http');

      await expect(staffGuard.canActivate(context)).resolves.toBe(true);
      expect(request.applicationActorId).toBe(STAFF_ACTOR_ID);
    });

    it('실 DB의 STUDENT actor를 판정 전용 403으로 거부한다', async () => {
      const context = new ExecutionContextHost([
        { sessionGithubId: STUDENT_ACTOR_GITHUB_ID },
      ]);
      context.setType('http');

      await expect(staffGuard.canActivate(context)).rejects.toMatchObject({
        errorCode: { code: ApplicationsErrorCode.STAFF_ONLY, status: 403 },
      });
    });
  });

  it(
    '권한 확인→승인 판정→outbox 소비→worker 편입까지 실 DB로 완주해 ' +
      'owner/repo와 defaultBranch를 가진 수집 행을 남긴다',
    async () => {
      const guardRequest: { sessionGithubId: bigint } = {
        sessionGithubId: STAFF_GITHUB_ID,
      };
      const guardContext = new ExecutionContextHost([guardRequest]);
      guardContext.setType('http');
      await expect(staffGuard.canActivate(guardContext)).resolves.toBe(true);

      await createOwnApplication(
        CHAIN_APPLICATION_ID,
        APPLICANT_ID,
        OWN_REPOSITORY_URL,
      );

      const decision = await service.decide(
        STAFF_ACTOR_ID,
        CHAIN_APPLICATION_ID,
        STAFF_GITHUB_ID,
        { action: 'APPROVE' },
      );

      expect(decision.kind).toBe('APPROVED');
      if (decision.kind !== 'APPROVED') {
        throw new Error('fixture approval must succeed');
      }
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
      const worker = new RepositoryProvisionWorker(
        jobs,
        state,
        github,
        ownEnrollment(),
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
          where: { applicationId: CHAIN_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({
        githubRepositoryId: OWN_GITHUB_REPOSITORY_ID,
      });
      await expect(
        prisma.repositoryProvisionJob.findUniqueOrThrow({
          where: { applicationId: CHAIN_APPLICATION_ID },
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
        ECONOVATION_REPOSITORY_URL,
      );

      const decision = await service.decide(
        STAFF_ACTOR_ID,
        ORG_OWNER_EXTERNAL_APPLICATION_ID,
        STAFF_GITHUB_ID,
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
      const worker = new RepositoryProvisionWorker(
        jobs,
        state,
        github,
        ownEnrollment(),
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
        applicationId: ORG_OWNER_EXTERNAL_APPLICATION_ID,
      });
      await expect(
        prisma.repositoryProvisionJob.findUniqueOrThrow({
          where: { applicationId: ORG_OWNER_EXTERNAL_APPLICATION_ID },
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
      NO_CONSENT_REPOSITORY_URL,
    );
    const decision = await service.decide(
      STAFF_ACTOR_ID,
      NO_CONSENT_APPLICATION_ID,
      STAFF_GITHUB_ID,
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
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      ownEnrollment(),
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
      applicationId: NO_CONSENT_APPLICATION_ID,
      source: 'EXTERNAL_PUBLIC',
      defaultBranch: null,
      lastSuccessAt: null,
    });
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId: NO_CONSENT_APPLICATION_ID },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.FAILED_RETRYABLE,
    });
  });

  it(
    'org sweep이 먼저 applicationId:null로 관찰해 둔 저장소를 OWN+ORGANIZATION ' +
      '연결이 채택해 성공한다(#617 단계 D 회귀 — recordRepository가 applicationId ' +
      '기준으로만 upsert하면 githubRepositoryId unique 제약과 충돌해 항상 실패했다)',
    async () => {
      await prisma.githubRepository.create({
        data: {
          githubRepositoryId: ORG_GITHUB_REPOSITORY_ID,
          nameWithOwner: ORG_OWN_NAME_WITH_OWNER,
          defaultBranch: null,
          archived: false,
          visibility: RepositoryVisibility.PRIVATE,
          source: 'ORG_PROVISIONED',
          presence: 'PRESENT',
        },
      });

      await createOwnApplication(
        ORG_OWN_APPLICATION_ID,
        ORG_OWN_APPLICANT_ID,
        ORG_OWN_REPOSITORY_URL,
      );
      const decision = await service.decide(
        STAFF_ACTOR_ID,
        ORG_OWN_APPLICATION_ID,
        STAFF_GITHUB_ID,
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
      const worker = new RepositoryProvisionWorker(
        jobs,
        state,
        github,
        ownEnrollment(),
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
        applicationId: ORG_OWN_APPLICATION_ID,
        source: 'ORG_PROVISIONED',
        presence: 'PRESENT',
      });
      await expect(
        prisma.repositoryProvisionJob.findUniqueOrThrow({
          where: { applicationId: ORG_OWN_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      });
    },
  );
  it('keeps the relinked binding when an earlier approval outbox is consumed later', async () => {
    await createOwnApplication(
      CHAIN_APPLICATION_ID,
      APPLICANT_ID,
      OWN_REPOSITORY_URL,
    );
    await service.decide(
      STAFF_ACTOR_ID,
      CHAIN_APPLICATION_ID,
      STAFF_GITHUB_ID,
      { action: 'APPROVE' },
    );
    const github = githubClient();
    github.findPublicRepository.mockResolvedValue(
      ownRepositoryMetadata(OWN_GITHUB_REPOSITORY_ID, OWN_NAME_WITH_OWNER),
    );
    const relink = new StudentRepositoryUrlService(
      new StudentRepositoryUrlRepository(prisma),
      repository,
      new OwnRepositoryUrlValidationService(github),
      new ConsentsService(new ConsentsRepository(prisma)),
      new AuditLogService(new AuditLogRepository(prisma)),
      { collectRepository: jest.fn() },
    );
    await relink.updateMine(
      APPLICANT_GITHUB_ID,
      programIdFor(CHAIN_APPLICATION_ID),
      { repositoryUrl: OWN_REPOSITORY_URL },
    );
    const current = await prisma.githubRepository.findUniqueOrThrow({
      where: { applicationId: CHAIN_APPLICATION_ID },
    });
    const queueNow = await consumeApproval(
      CHAIN_APPLICATION_ID,
      'synthetic-late-outbox',
    );

    await new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      ownEnrollment(),
    ).runNext('synthetic-late-worker', queueNow);
    await expect(
      prisma.githubRepository.findUniqueOrThrow({
        where: { applicationId: CHAIN_APPLICATION_ID },
      }),
    ).resolves.toMatchObject({ id: current.id });
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId: CHAIN_APPLICATION_ID },
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
    'rejects unavailable legacy OWN repository %s during provisioning',
    async (applicationId, metadata) => {
      await createOwnApplication(
        applicationId,
        PRECHECK_APPLICANT_ID,
        'https://github.com/synthetic/private',
      );
      await service.decide(STAFF_ACTOR_ID, applicationId, STAFF_GITHUB_ID, {
        action: 'APPROVE',
      });
      const queueNow = await consumeApproval(
        applicationId,
        'synthetic-legacy-outbox',
      );
      const github = githubClient();
      github.findPublicRepository.mockResolvedValue(metadata);
      const result = await new RepositoryProvisionWorker(
        jobs,
        state,
        github,
        ownEnrollment(),
      ).runNext('synthetic-legacy-provision', queueNow);
      expect(result).toMatchObject({
        kind: 'FAILED_FINAL',
        errorCode: PROVISION_ERROR_CODES.OWN_REPOSITORY_NOT_FOUND,
      });
      expect(
        await prisma.githubRepository.count({ where: { applicationId } }),
      ).toBe(0);
    },
  );
});

function programIdFor(applicationId: string): string {
  return `${applicationId}-program`;
}

async function consumeApproval(
  applicationId: string,
  workerId: string,
): Promise<Date> {
  const event = await prisma.outboxEvent.findUniqueOrThrow({
    where: { idempotencyKey: `repository-provision:${applicationId}` },
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

function teamIdFor(applicationId: string): string {
  return `${applicationId}-team`;
}

async function createOwnApplication(
  applicationId: string,
  applicantId: string,
  repositoryUrl: string,
): Promise<void> {
  const programId = programIdFor(applicationId);
  const teamId = teamIdFor(applicationId);
  await prisma.program.create({
    data: {
      id: programId,
      name: `program-${applicationId}`,
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
      name: `team-${applicationId}`,
      joinCodeDigest: `digest-${applicationId}`,
      leaderId: applicantId,
    },
  });
  await prisma.teamMember.create({
    data: {
      id: `${applicationId}-team-member`,
      teamId,
      programId,
      userId: applicantId,
    },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId,
      applicantId,
      teamId,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      repositoryConnectionMode: RepositoryConnectionMode.OWN,
      repositoryUrl,
    },
  });
}

function ownEnrollment(): RepositoryOwnEnrollmentService {
  return new RepositoryOwnEnrollmentService(
    new ConsentsService(new ConsentsRepository(prisma)),
    new CollectionIncrementalRepository(prisma),
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

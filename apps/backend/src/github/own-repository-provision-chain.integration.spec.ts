import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import {
  ProgramCategory,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { ApplicationsErrorCode } from '../applications/applications-error-code.enum';
import { ApplicationsStaffGuard } from '../applications/applications-staff.guard';
import { ApplicationsRepository } from '../applications/applications.repository';
import { ApplicationsService } from '../applications/applications.service';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ConsentsRepository } from '../consents/consents.repository';
import { ConsentsService } from '../consents/consents.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  GithubAppClient,
  GithubPublicRepositoryMetadata,
} from './github-app.client';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { RepositoriesRepository } from './repository/repositories.repository';
import { RepositoryProvisionJobRepository } from './repository/repository-provision-job.repository';
import { RepositoryProvisionStateRepository } from './repository/repository-provision-state.repository';
import { RepositoryOutboxConsumer } from './repository-outbox.consumer';
import { RepositoryProvisionWorker } from './repository-provision.worker';
import { RepositoryOwnEnrollmentService } from './service/repository-own-enrollment.service';

// allow: SIZE_OK — OWN 저장소 승인→편입 사슬이 하나의 격리 PostgreSQL lifecycle을 공유한다.
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

// 이 스펙은 applications 승인 판정과 github 편입 worker를 잇는 사슬을 검증한다.
// applications/domain의 승인 액션(현재 리터럴 'APPROVE')은 github zone의
// module-zone-boundary(ADR-003 DEC-42) 아래서 internalDirs로 막혀 import할 수
// 없으므로, decide()의 contextual typing에 맡겨 리터럴을 그대로 쓴다.
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

const CHAIN_APPLICATION_ID = 'synthetic-own-chain-application';
const NO_CONSENT_APPLICATION_ID = 'synthetic-own-chain-no-consent-application';
const APPLICATION_IDS = [
  CHAIN_APPLICATION_ID,
  NO_CONSENT_APPLICATION_ID,
] as const;

const OWN_GITHUB_REPOSITORY_ID = 8_520_100_001n;
const OWN_NAME_WITH_OWNER =
  'synthetic-own-chain-student/synthetic-own-chain-repo';
const OWN_REPOSITORY_URL = `https://github.com/${OWN_NAME_WITH_OWNER}`;

const NO_CONSENT_GITHUB_REPOSITORY_ID = 8_520_100_002n;
const NO_CONSENT_NAME_WITH_OWNER =
  'synthetic-own-chain-student/synthetic-own-chain-no-consent-repo';
const NO_CONSENT_REPOSITORY_URL = `https://github.com/${NO_CONSENT_NAME_WITH_OWNER}`;

type ProvisionGithubClient = jest.Mocked<
  Pick<
    GithubAppClient,
    | 'findRepository'
    | 'createRepository'
    | 'ensureCollaborator'
    | 'findPublicRepository'
  >
>;

describe('OWN 저장소 연결·생성 사슬 통합', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        {
          id: STAFF_ACTOR_ID,
          githubId: STAFF_GITHUB_ID,
          nickname: 'synthetic-own-chain-staff',
          role: Role.STAFF,
        },
        {
          id: STUDENT_ACTOR_ID,
          githubId: STUDENT_ACTOR_GITHUB_ID,
          nickname: 'synthetic-own-chain-student-actor',
          role: Role.STUDENT,
        },
        {
          id: APPLICANT_ID,
          githubId: APPLICANT_GITHUB_ID,
          nickname: 'synthetic-own-chain-applicant',
          role: Role.STUDENT,
        },
        {
          id: NO_CONSENT_APPLICANT_ID,
          githubId: NO_CONSENT_APPLICANT_GITHUB_ID,
          // github 로그인 형식 계약(39자 이하, 영소문자/숫자/하이픈)을 지킨다 —
          // outbox payload의 collaboratorGithubLogins가 이 nickname으로 채워지고
          // RepositoryOutboxConsumer가 그 계약을 검증한다.
          nickname: 'synthetic-own-chain-no-consent',
          role: Role.STUDENT,
        },
      ],
    });
    // 편입은 현재 동의를 요구한다(RepositoryOwnEnrollmentService) — 정책 버전은
    // 서비스가 알려주는 값을 쓴다. 상수를 복사하면 정책이 올라갈 때 이 스펙만
    // 조용히 옛 버전을 붙들고 통과한다.
    const { policy } = await new ConsentsService(
      new ConsentsRepository(prisma),
    ).getCurrent(APPLICANT_GITHUB_ID);
    await prisma.consent.create({
      data: { userId: APPLICANT_ID, policyVersion: policy.policyVersion },
    });
    // NO_CONSENT_APPLICANT_ID는 의도적으로 동의 행을 만들지 않는다.
  });

  afterEach(async () => {
    await prisma.githubRepository.deleteMany({
      where: {
        githubRepositoryId: {
          in: [OWN_GITHUB_REPOSITORY_ID, NO_CONSENT_GITHUB_REPOSITORY_ID],
        },
      },
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
    await prisma.consent.deleteMany({ where: { userId: APPLICANT_ID } });
    // #547 이후 판정이 AuditLog 행을 남긴다 — append-only 트리거가 삭제를 막고
    // actor를 FK(restrict)로 잡으므로 합성 사용자는 지우지 않는다. 통합 DB는
    // run마다 버려지는 컨테이너다.
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
      // Given — STAFF actor가 권한 확인을 통과하고, OWN 신청이 승인 대기 중이다.
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

      // When — 실 서비스로 승인 판정을 내린다.
      const decision = await service.decide(
        STAFF_ACTOR_ID,
        CHAIN_APPLICATION_ID,
        STAFF_GITHUB_ID,
        { action: 'APPROVE' },
      );

      // Then — outbox 이벤트가 생겼다.
      expect(decision.kind).toBe('APPROVED');
      await expect(
        prisma.outboxEvent.findUniqueOrThrow({
          where: {
            idempotencyKey: `repository-provision:${CHAIN_APPLICATION_ID}`,
          },
        }),
      ).resolves.toMatchObject({ status: 'PENDING' });

      // When — outbox를 job으로 소비한다.
      await expect(
        outbox.consumeNext('own-chain-outbox-worker', new Date()),
      ).resolves.toMatchObject({ kind: 'CONSUMED' });

      // When — worker가 job을 처리한다(GitHub 경계만 mock, 편입 서비스는 real+real DB).
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
        new Date(),
      );

      // Then — 편입 서비스가 owner/repo, defaultBranch를 가진 수집 행을 real DB에 남긴다.
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
        prisma.repository.findUniqueOrThrow({
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

  it('현재 동의가 없으면 worker 편입이 실패로 끝나고 수집 행을 남기지 않는다', async () => {
    // Given — 동의 없는 신청자의 OWN 신청이 승인되어 job까지 만들어졌다.
    await createOwnApplication(
      NO_CONSENT_APPLICATION_ID,
      NO_CONSENT_APPLICANT_ID,
      NO_CONSENT_REPOSITORY_URL,
    );
    await service.decide(
      STAFF_ACTOR_ID,
      NO_CONSENT_APPLICATION_ID,
      STAFF_GITHUB_ID,
      { action: 'APPROVE' },
    );
    await expect(
      outbox.consumeNext('own-chain-no-consent-outbox-worker', new Date()),
    ).resolves.toMatchObject({ kind: 'CONSUMED' });
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

    // When
    const result = await worker.runNext(
      'own-chain-no-consent-provision-worker',
      new Date(),
    );

    // Then — 동의 선행조건(RepositoryOwnEnrollmentService.requireCurrent)에 막혀
    // job은 재시도 가능 실패로 끝나고 수집 행은 만들어지지 않는다.
    expect(result.kind).toBe('FAILED_RETRYABLE');
    await expect(
      prisma.githubRepository.findFirst({
        where: { githubRepositoryId: NO_CONSENT_GITHUB_REPOSITORY_ID },
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId: NO_CONSENT_APPLICATION_ID },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.FAILED_RETRYABLE,
    });
  });
});

function programIdFor(applicationId: string): string {
  return `${applicationId}-program`;
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
    findPublicRepository: jest.fn().mockResolvedValue(null),
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

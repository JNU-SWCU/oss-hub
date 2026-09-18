import {
  ApplicationStatus,
  CollectionRepositoryPresence,
  MemberKind,
  OutboxEventStatus,
  ProgramCategory,
  RepositoryInvitationStatus,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  ProgramTrackType,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { transferProvisionGeneration } from '../prisma/repository-provision-generation';
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
import { RepositoryConnectionsRepository } from './repository/repository-connections.repository';
import { RepositoryOutboxConsumer } from './repository-outbox.consumer';
import {
  parseRepositoryProvisionEvent,
  REPOSITORY_PROVISION_EVENT_TYPE,
} from './repository-provision-event';
import { RepositoryProvisionJobRepository } from './repository/repository-provision-job.repository';
import { RepositoryProvisionStateRepository } from './repository/repository-provision-state.repository';
import { RepositoryProvisionWorker } from './repository-provision.worker';
import { RepositoryProvisionLeaseLostError } from './repository-provision-state.helpers';
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
const CONNECTION_ACTOR_ID = 'synthetic-worker-connection-staff';
const CONNECTION_ACTOR_GITHUB_ID = 8_300_000_099_001n;
const APPLICATION_IDS = [
  'synthetic-worker-success',
  'synthetic-worker-partial',
  'synthetic-worker-reconciliation-cap',
  'synthetic-worker-reconciliation-exhausted',
  'synthetic-worker-own-enrollment',
  'synthetic-worker-revoke-lifecycle',
  'synthetic-worker-stale-membership',
  'synthetic-worker-invitation-cas',
  'synthetic-worker-final-failure-rearm',
  'synthetic-worker-terminal-failure',
  'synthetic-worker-generation-race',
  'synthetic-worker-current-relink',
  'synthetic-worker-new-external-current',
  'synthetic-worker-own-managed-current',
  'synthetic-worker-own-org-create',
] as const;
const APPLICANT_LOGIN = 'synthetic-worker-applicant';
/** 표기가 섞인 회원 — 정규화 없이 비교하면 같은 사람을 둘로 읽는다. */
const MEMBER_USER = {
  id: 'synthetic-worker-member-id',
  githubId: 8_300_000_000_002n,
  nickname: 'Synthetic-Worker-Member',
  login: 'synthetic-worker-member',
} as const;
const GHOST_USER = {
  id: 'synthetic-worker-ghost-id',
  githubId: 8_300_000_000_003n,
  nickname: 'synthetic-worker-ghost',
  login: 'synthetic-worker-ghost',
} as const;
const OWN_GITHUB_REPOSITORY_ID = 8_520_000_001n;
const OWN_NAME_WITH_OWNER = 'synthetic-student/synthetic-own-repo';
const OWN_REPOSITORY_URL = `https://github.com/${OWN_NAME_WITH_OWNER}`;
const PREVIOUS_MANAGED_GITHUB_REPOSITORY_ID = 8_520_000_101n;
const CURRENT_MANAGED_GITHUB_REPOSITORY_ID = 8_520_000_102n;
const NEW_EXTERNAL_CURRENT_GITHUB_REPOSITORY_ID = 8_520_000_103n;
const OWN_MANAGED_CURRENT_GITHUB_REPOSITORY_ID = 8_520_000_104n;
const OWN_ORG_CREATE_GITHUB_REPOSITORY_ID = 8_520_000_105n;

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

describe('RepositoryProvisionWorker integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: APPLICANT_ID,
        githubId: APPLICANT_GITHUB_ID,
        nickname: APPLICANT_LOGIN,
        selectedMemberKind: MemberKind.STUDENT,
      },
    });
    await prisma.user.createMany({
      data: [
        ...[MEMBER_USER, GHOST_USER].map((user) => ({
          id: user.id,
          githubId: user.githubId,
          nickname: user.nickname,
          selectedMemberKind: MemberKind.STUDENT,
        })),
        {
          id: CONNECTION_ACTOR_ID,
          githubId: CONNECTION_ACTOR_GITHUB_ID,
          nickname: 'synthetic-worker-connection-staff',
          selectedMemberKind: MemberKind.STAFF,
          hasStaffAccess: true,
        },
      ],
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
    await prisma.repositoryIssuanceHistory.deleteMany({
      where: { applicationId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.repositoryInvitation.deleteMany({
      where: {
        OR: [
          { repository: { applicationId: { in: [...APPLICATION_IDS] } } },
          {
            repository: {
              githubRepositoryId: {
                in: [
                  OWN_GITHUB_REPOSITORY_ID,
                  PREVIOUS_MANAGED_GITHUB_REPOSITORY_ID,
                  CURRENT_MANAGED_GITHUB_REPOSITORY_ID,
                  NEW_EXTERNAL_CURRENT_GITHUB_REPOSITORY_ID,
                  OWN_MANAGED_CURRENT_GITHUB_REPOSITORY_ID,
                  OWN_ORG_CREATE_GITHUB_REPOSITORY_ID,
                ],
              },
            },
          },
        ],
      },
    });
    await prisma.repositoryProvisionJob.deleteMany({
      where: { applicationId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.githubRepository.deleteMany({
      where: { applicationId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.githubRepository.deleteMany({
      where: {
        githubRepositoryId: {
          in: [
            OWN_GITHUB_REPOSITORY_ID,
            PREVIOUS_MANAGED_GITHUB_REPOSITORY_ID,
            CURRENT_MANAGED_GITHUB_REPOSITORY_ID,
            NEW_EXTERNAL_CURRENT_GITHUB_REPOSITORY_ID,
            OWN_MANAGED_CURRENT_GITHUB_REPOSITORY_ID,
            OWN_ORG_CREATE_GITHUB_REPOSITORY_ID,
          ],
        },
      },
    });
    await prisma.application.deleteMany({
      where: { id: { in: [...APPLICATION_IDS] } },
    });
    await prisma.teamMember.deleteMany({
      where: { teamId: { in: APPLICATION_IDS.map(teamIdFor) } },
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
    // connection actor는 append-only AuditLog FK가 잡으므로 격리 DB 수명까지 남긴다.
    await prisma.user.deleteMany({
      where: { id: { in: [APPLICANT_ID, MEMBER_USER.id, GHOST_USER.id] } },
    });
    await prisma.$disconnect();
  });

  it('과거 outbox 명단 대신 현재 팀원에게 저장소 접근을 부여한다', async () => {
    // Given: 승인된 신청 outbox가 job으로 변환됐다.
    const applicationId = APPLICATION_IDS[0];
    await createApplicationAndEvent(applicationId, [
      'synthetic-leader',
      'synthetic-student',
    ]);
    await addTeamMember(applicationId, MEMBER_USER.id, 'current-member');
    await outbox.consumeNext('outbox-worker-a', NOW);
    const requestId = (
      await prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
        select: { currentEventId: true },
      })
    ).currentEventId;
    expect(requestId).not.toBeNull();
    const github = githubClient();
    github.ensureCollaborator
      .mockResolvedValueOnce(COLLABORATOR_OUTCOMES.PENDING)
      .mockResolvedValueOnce(COLLABORATOR_OUTCOMES.SUCCEEDED);
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    // When: provision worker가 job을 처리한다.
    const result = await worker.runNext('provision-worker-a', NOW);

    // Then: private repository 한 건과 현재 팀원별 invitation이 저장된다.
    expect(result.kind).toBe('SUCCEEDED');
    const repository = await prisma.githubRepository.findUniqueOrThrow({
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
      [APPLICANT_LOGIN, RepositoryInvitationStatus.PENDING],
      [MEMBER_USER.login, RepositoryInvitationStatus.SUCCEEDED],
    ]);
    await prisma.repositoryInvitation.updateMany({
      where: {
        repositoryId: repository.id,
        githubLogin: APPLICANT_LOGIN,
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
          githubLogin: APPLICANT_LOGIN,
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
    await expect(
      prisma.repositoryIssuanceHistory.findUniqueOrThrow({
        where: { requestId: requestId ?? '' },
      }),
    ).resolves.toMatchObject({
      applicationId,
      repositoryId: repository.id,
      connectionMode: 'NEW',
      source: RepositorySource.ORG_PROVISIONED,
      outcome: RepositoryIssuanceOutcome.SUCCEEDED,
      requestedAt: NOW,
    });
    await expect(
      prisma.repositoryIssuanceHistory.count({
        where: { requestId: requestId ?? '' },
      }),
    ).resolves.toBe(1);
  });

  it('최종 실패를 정확한 requestId로 한 번만 이력에 닫는다', async () => {
    const applicationId = APPLICATION_IDS[9];
    await createApplicationAndEvent(applicationId, [APPLICANT_LOGIN]);
    await outbox.consumeNext('outbox-worker-terminal-failure', NOW);
    const job = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { applicationId },
      select: { currentEventId: true },
    });
    expect(job.currentEventId).not.toBeNull();
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: ApplicationStatus.REJECTED },
    });
    const worker = new RepositoryProvisionWorker(jobs, state, githubClient(), {
      enrollExternalRepository: jest.fn(),
    });

    await expect(
      worker.runNext('provision-worker-terminal-failure', NOW),
    ).resolves.toMatchObject({ kind: 'FAILED_FINAL' });
    await expect(
      prisma.repositoryIssuanceHistory.findUniqueOrThrow({
        where: { requestId: job.currentEventId ?? '' },
      }),
    ).resolves.toMatchObject({
      applicationId,
      repositoryId: null,
      connectionMode: 'NEW',
      source: null,
      outcome: RepositoryIssuanceOutcome.FAILED_FINAL,
      lastErrorCode: PROVISION_ERROR_CODES.APPLICATION_NOT_APPROVED,
      requestedAt: NOW,
    });
    await expect(
      prisma.repositoryIssuanceHistory.count({
        where: { requestId: job.currentEventId ?? '' },
      }),
    ).resolves.toBe(1);
  });

  it('R2 수락 뒤 R1 worker는 붙이지 못하고 R2만 완료한다', async () => {
    const applicationId = APPLICATION_IDS[10];
    await createApplicationAndEvent(applicationId, [APPLICANT_LOGIN]);
    const r1 = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `repository-provision:${applicationId}` },
    });
    const claimedR1 = await claimJobFor(applicationId, 'worker-r1');
    const r2At = new Date(NOW.getTime() + 1_000);
    const connections = new RepositoryConnectionsRepository(prisma);

    await expect(
      connections.changeConnection(
        applicationId,
        {
          userId: CONNECTION_ACTOR_ID,
          githubId: CONNECTION_ACTOR_GITHUB_ID,
          isStaff: true,
        },
        { mode: 'NEW' },
        r2At,
      ),
    ).resolves.toMatchObject({ status: 'PENDING' });
    const afterR2 = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { applicationId },
    });
    expect(afterR2).toMatchObject({
      status: RepositoryProvisionJobStatus.PENDING,
      attemptCount: 0,
      lockedAt: null,
      lockedBy: null,
      repositoryId: null,
    });
    expect(afterR2.currentEventId).not.toBe(r1.id);

    await expect(
      state.recordRepository({
        jobId: claimedR1.id,
        workerId: 'worker-r1',
        requestId: r1.id,
        applicationId,
        programId: programId(applicationId),
        teamId: teamIdFor(applicationId),
        metadata: repositoryMetadata('stale-r1', 'stale R1'),
        source: RepositorySource.ORG_PROVISIONED,
        currentConnectionMode: 'NEW',
        currentRepositoryUrl: null,
        connectionMode: 'NEW',
        repositoryUrl: null,
      }),
    ).rejects.toMatchObject({
      name: 'RepositoryProvisionSupersededError',
      staleRequestId: r1.id,
    });
    await expect(
      prisma.githubRepository.count({ where: { applicationId } }),
    ).resolves.toBe(0);
    await state.recordSupersededRequest(applicationId, r1.id, r2At);

    const consumedR1 = await outbox.consumeNext('outbox-r1', r2At);
    expect(consumedR1).toMatchObject({ kind: 'CONSUMED', eventId: r1.id });
    const consumedR2 = await outbox.consumeNext(
      'outbox-r2',
      new Date(r2At.getTime() + 1),
    );
    expect(consumedR2).toMatchObject({
      kind: 'CONSUMED',
      eventId: afterR2.currentEventId,
    });
    const worker = new RepositoryProvisionWorker(jobs, state, githubClient(), {
      enrollExternalRepository: jest.fn(),
    });
    await expect(
      worker.runNext('worker-r2', new Date(r2At.getTime() + 2)),
    ).resolves.toMatchObject({ kind: 'SUCCEEDED' });

    await expect(
      prisma.repositoryIssuanceHistory.findMany({
        where: { applicationId },
        orderBy: { requestedAt: 'asc' },
        select: { requestId: true, outcome: true },
      }),
    ).resolves.toEqual([
      { requestId: r1.id, outcome: RepositoryIssuanceOutcome.SUPERSEDED },
      {
        requestId: afterR2.currentEventId,
        outcome: RepositoryIssuanceOutcome.SUCCEEDED,
      },
    ]);
  });

  it('다른 관리형 private 저장소로 바꾸면 현재 저장소에만 초대를 보내고 이전 성공 초대는 쓰지 않는다', async () => {
    // Given: NEW 승인 job이 있고, 이전 관리형 저장소의 성공 초대는 분리된 행에
    // 남으며 현재 연결만 application.repository다.
    const applicationId = 'synthetic-worker-current-relink';
    await createApplicationAndEvent(applicationId, [APPLICANT_LOGIN]);
    await outbox.consumeNext('outbox-worker-current-relink', NOW);
    const previous = await prisma.githubRepository.create({
      data: {
        programId: programId(applicationId),
        teamId: teamIdFor(applicationId),
        githubRepositoryId: PREVIOUS_MANAGED_GITHUB_REPOSITORY_ID,
        nameWithOwner: `synthetic-org/${applicationId}-previous`,
        visibility: RepositoryVisibility.PRIVATE,
        source: RepositorySource.ORG_PROVISIONED,
        presence: CollectionRepositoryPresence.PRESENT,
      },
    });
    await prisma.repositoryInvitation.create({
      data: {
        repositoryId: previous.id,
        githubLogin: APPLICANT_LOGIN,
        status: RepositoryInvitationStatus.SUCCEEDED,
      },
    });
    const current = await prisma.githubRepository.create({
      data: {
        applicationId,
        programId: programId(applicationId),
        teamId: teamIdFor(applicationId),
        githubRepositoryId: CURRENT_MANAGED_GITHUB_REPOSITORY_ID,
        nameWithOwner: `synthetic-org/${applicationId}-current`,
        visibility: RepositoryVisibility.PRIVATE,
        source: RepositorySource.ORG_PROVISIONED,
        presence: CollectionRepositoryPresence.PRESENT,
      },
    });
    await prisma.repositoryProvisionJob.update({
      where: { applicationId },
      data: { repositoryId: current.id },
    });
    const github = githubClient();
    github.ensureCollaborator.mockResolvedValue(
      COLLABORATOR_OUTCOMES.SUCCEEDED,
    );
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    // When: 현재 연결 저장소로 provision job을 실행한다.
    const result = await worker.runNext('provision-worker-current-relink', NOW);

    // Then: 현재 저장소에만 초대를 보내고 이전 성공 행은 그대로다.
    expect(result.kind).toBe('SUCCEEDED');
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(github.ensureCollaborator.mock.calls).toEqual([
      [`${applicationId}-current`, APPLICANT_LOGIN],
    ]);
    await expect(
      prisma.repositoryInvitation.findMany({
        where: { repositoryId: current.id },
        select: { githubLogin: true, status: true },
      }),
    ).resolves.toEqual([
      {
        githubLogin: APPLICANT_LOGIN,
        status: RepositoryInvitationStatus.SUCCEEDED,
      },
    ]);
    await expect(
      prisma.repositoryInvitation.findMany({
        where: { repositoryId: previous.id },
        select: { githubLogin: true, status: true },
      }),
    ).resolves.toEqual([
      {
        githubLogin: APPLICANT_LOGIN,
        status: RepositoryInvitationStatus.SUCCEEDED,
      },
    ]);
  });
  it('원래 NEW 이벤트여도 현재 EXTERNAL_PUBLIC 행이면 관리형 초대를 건너뛴다', async () => {
    // Given: 승인 이벤트는 NEW이고 현재 연결만 외부 공개 저장소다.
    const applicationId = 'synthetic-worker-new-external-current';
    await createApplicationAndEvent(applicationId, [APPLICANT_LOGIN]);
    await outbox.consumeNext('outbox-worker-new-external', NOW);
    await prisma.githubRepository.create({
      data: {
        applicationId,
        programId: programId(applicationId),
        teamId: teamIdFor(applicationId),
        githubRepositoryId: NEW_EXTERNAL_CURRENT_GITHUB_REPOSITORY_ID,
        nameWithOwner: `synthetic-student/${applicationId}-external`,
        visibility: RepositoryVisibility.PUBLIC,
        source: RepositorySource.EXTERNAL_PUBLIC,
        presence: CollectionRepositoryPresence.PRESENT,
      },
    });
    await prisma.repositoryProvisionJob.update({
      where: { applicationId },
      data: {
        repositoryId: (
          await prisma.githubRepository.findUniqueOrThrow({
            where: { applicationId },
          })
        ).id,
      },
    });
    const github = githubClient();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    // When
    const result = await worker.runNext('provision-worker-new-external', NOW);

    // Then: 이벤트 NEW를 쓰지 않고 현재 외부 행에 초대를 보내지 않는다.
    expect(result.kind).toBe('SUCCEEDED');
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(github.ensureCollaborator.mock.calls).toHaveLength(0);
    expect(github.findPublicRepository.mock.calls).toHaveLength(0);
    await expect(
      prisma.repositoryInvitation.count({
        where: {
          repository: {
            githubRepositoryId: NEW_EXTERNAL_CURRENT_GITHUB_REPOSITORY_ID,
          },
        },
      }),
    ).resolves.toBe(0);
  });

  it('원래 OWN 이벤트여도 현재 ORG_PROVISIONED 행이면 현재 저장소에 초대한다', async () => {
    // Given: 승인 이벤트는 OWN이고 현재 연결은 관리형 private 저장소다.
    const applicationId = 'synthetic-worker-own-managed-current';
    await createApplicationAndEvent(applicationId, [APPLICANT_LOGIN], {
      connectionMode: 'OWN',
      repositoryUrl: OWN_REPOSITORY_URL,
    });
    await outbox.consumeNext('outbox-worker-own-managed', NOW);
    const current = await prisma.githubRepository.create({
      data: {
        applicationId,
        programId: programId(applicationId),
        teamId: teamIdFor(applicationId),
        githubRepositoryId: OWN_MANAGED_CURRENT_GITHUB_REPOSITORY_ID,
        nameWithOwner: `synthetic-org/${applicationId}-managed`,
        visibility: RepositoryVisibility.PRIVATE,
        source: RepositorySource.ORG_PROVISIONED,
        presence: CollectionRepositoryPresence.PRESENT,
      },
    });
    await prisma.repositoryProvisionJob.update({
      where: { applicationId },
      data: { repositoryId: current.id },
    });
    const github = githubClient();
    github.ensureCollaborator.mockResolvedValue(
      COLLABORATOR_OUTCOMES.SUCCEEDED,
    );
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    // When
    const result = await worker.runNext('provision-worker-own-managed', NOW);

    // Then: 현재 행에만 초대하고 완료 전까지 관리형 경로를 유지한다.
    expect(result.kind).toBe('SUCCEEDED');
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(github.findPublicRepository.mock.calls).toHaveLength(0);
    expect(github.ensureCollaborator.mock.calls).toEqual([
      [`${applicationId}-managed`, APPLICANT_LOGIN],
    ]);
    await expect(
      prisma.repositoryInvitation.findMany({
        where: { repositoryId: current.id },
        select: { githubLogin: true, status: true },
      }),
    ).resolves.toEqual([
      {
        githubLogin: APPLICANT_LOGIN,
        status: RepositoryInvitationStatus.SUCCEEDED,
      },
    ]);
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      repositoryId: current.id,
    });
  });
  it('처음 OWN+행 없음이 조직 저장소로 기록되면 초대를 보내고 재조회를 남긴다', async () => {
    // Given: OWN 승인에 현재 행이 없고 조직 안 저장소가 App으로 확인된다.
    const applicationId = 'synthetic-worker-own-org-create';
    const repositoryUrl = `https://github.com/synthetic-org/${applicationId}`;
    await createApplicationAndEvent(applicationId, [APPLICANT_LOGIN], {
      connectionMode: 'OWN',
      repositoryUrl,
    });
    await outbox.consumeNext('outbox-worker-own-org-create', NOW);
    const github = githubClient();
    github.findRepository.mockResolvedValue({
      githubRepositoryId: OWN_ORG_CREATE_GITHUB_REPOSITORY_ID,
      name: applicationId,
      url: repositoryUrl,
      nameWithOwner: `synthetic-org/${applicationId}`,
      visibility: RepositoryVisibility.PRIVATE,
      description: null,
    });
    github.ensureCollaborator.mockResolvedValue(COLLABORATOR_OUTCOMES.PENDING);
    const enrollExternalRepository = jest.fn();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository,
    });

    // When: 현재 행 없이 첫 provision을 실행한다.
    const result = await worker.runNext('provision-worker-own-org-create', NOW);

    // Then: 기록된 ORG_PROVISIONED가 초대를 만들고 관리형 재조회를 남긴다.
    expect(result.kind).toBe('SUCCEEDED');
    expect(github.findPublicRepository.mock.calls).toHaveLength(0);
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(enrollExternalRepository).not.toHaveBeenCalled();
    expect(github.ensureCollaborator.mock.calls).toEqual([
      [applicationId, APPLICANT_LOGIN],
    ]);
    const recorded = await prisma.githubRepository.findUniqueOrThrow({
      where: { applicationId },
    });
    expect(recorded).toMatchObject({
      githubRepositoryId: OWN_ORG_CREATE_GITHUB_REPOSITORY_ID,
      source: RepositorySource.ORG_PROVISIONED,
    });
    await expect(
      prisma.repositoryInvitation.findMany({
        where: { repositoryId: recorded.id },
        select: { githubLogin: true, status: true },
      }),
    ).resolves.toEqual([
      {
        githubLogin: APPLICANT_LOGIN,
        status: RepositoryInvitationStatus.PENDING,
      },
    ]);
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      repositoryId: recorded.id,
      nextAttemptAt: new Date(
        NOW.getTime() + DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
      ),
    });
  });

  it('일부 초대 재시도에서 repository를 다시 만들지 않는다', async () => {
    // Given: 첫 실행에서 두 번째 invitation만 일시 실패한다.
    const applicationId = APPLICATION_IDS[1];
    await createApplicationAndEvent(applicationId, [
      'synthetic-leader',
      'synthetic-student',
    ]);
    await addTeamMember(applicationId, MEMBER_USER.id, 'current-member');
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
      [APPLICANT_LOGIN, MEMBER_USER.login, MEMBER_USER.login],
    );
    await expect(
      prisma.githubRepository.count({ where: { applicationId } }),
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
  it('작업을 재조회해도 확인 상한에 도달한 invitation은 재발송하지 않는다', async () => {
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
    const repository = await prisma.githubRepository.findUniqueOrThrow({
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

    // Then: 멤버십 재조회는 완료하지만 상한 invitation은 다시 확인하지 않는다.
    expect(result.kind).toBe('SUCCEEDED');
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
    const repository = await prisma.githubRepository.findUniqueOrThrow({
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
      prisma.githubRepository.findUniqueOrThrow({ where: { applicationId } }),
    ).resolves.toMatchObject({
      githubRepositoryId: OWN_GITHUB_REPOSITORY_ID,
    });
  });

  it('pending NEW reads its exact event target while the current OWN tuple remains visible', async () => {
    const applicationId = APPLICATION_IDS[4];
    await createApplicationAndEvent(applicationId, [APPLICANT_LOGIN], {
      connectionMode: 'OWN',
      repositoryUrl: OWN_REPOSITORY_URL,
    });
    await outbox.consumeNext('outbox-own-r1', NOW);
    await prisma.githubRepository.create({
      data: {
        applicationId,
        programId: programId(applicationId),
        teamId: teamIdFor(applicationId),
        githubRepositoryId: OWN_GITHUB_REPOSITORY_ID,
        nameWithOwner: OWN_NAME_WITH_OWNER,
        source: RepositorySource.EXTERNAL_PUBLIC,
        visibility: RepositoryVisibility.PUBLIC,
      },
    });
    const r2 = await prisma.$transaction(async (transaction) => {
      const event = await transaction.outboxEvent.create({
        data: {
          type: REPOSITORY_PROVISION_EVENT_TYPE,
          aggregateType: 'Application',
          aggregateId: applicationId,
          idempotencyKey: `repository-provision:${applicationId}:r2`,
          payload: {
            applicationId,
            programId: programId(applicationId),
            teamId: null,
            requestedAt: NOW.toISOString(),
            collaboratorGithubLogins: [APPLICANT_LOGIN],
            repositoryConnectionMode: 'NEW',
            repositoryUrl: null,
          },
          availableAt: NOW,
        },
      });
      await transferProvisionGeneration(
        transaction,
        { applicationId, newEventId: event.id, now: NOW },
        parseRepositoryProvisionEvent,
      );
      return event;
    });
    const claimed = await claimJobFor(applicationId, 'exact-event-worker');
    const context = await state.loadContext(
      claimed.id,
      'exact-event-worker',
      claimed.requestId,
    );
    expect(claimed.requestId).toBe(r2.id);
    expect(context).toMatchObject({
      requestedConnectionMode: 'NEW',
      requestedRepositoryUrl: null,
      repository: null,
    });
    await expect(
      prisma.application.findUniqueOrThrow({ where: { id: applicationId } }),
    ).resolves.toMatchObject({
      repositoryConnectionMode: 'OWN',
      repositoryUrl: OWN_REPOSITORY_URL,
    });
    await prisma.repositoryProvisionJob.update({
      where: { applicationId },
      data: {
        status: RepositoryProvisionJobStatus.PENDING,
        attemptCount: 0,
        lockedAt: null,
        lockedBy: null,
        startedAt: null,
        nextAttemptAt: NOW,
      },
    });
    await outbox.consumeNext('outbox-own-r2', NOW);
    const github = githubClient();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    await expect(
      worker.runNext('provision-worker-own-r2', NOW),
    ).resolves.toMatchObject({ kind: 'SUCCEEDED' });
    expect(github.createRepository.mock.calls).toHaveLength(1);
    expect(github.findPublicRepository.mock.calls).toHaveLength(0);
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: applicationId },
        include: { repository: true },
      }),
    ).resolves.toMatchObject({
      repositoryConnectionMode: 'NEW',
      repositoryUrl: null,
      repository: {
        githubRepositoryId: 987654321n,
        source: RepositorySource.ORG_PROVISIONED,
      },
    });
    await expect(
      prisma.githubRepository.findUniqueOrThrow({
        where: { githubRepositoryId: OWN_GITHUB_REPOSITORY_ID },
      }),
    ).resolves.toMatchObject({ applicationId: null });
  });

  it('부여→탈퇴 회수→재합류를 같은 행에서 이력을 남기며 수렴한다', async () => {
    // Given: 세 명이 속한 팀에 부여가 끝난 상태다.
    const applicationId = 'synthetic-worker-revoke-lifecycle';
    await createApplicationAndEvent(applicationId, [APPLICANT_LOGIN]);
    await addTeamMember(applicationId, MEMBER_USER.id, 'member');
    await addTeamMember(applicationId, GHOST_USER.id, 'ghost');
    await outbox.consumeNext('outbox-worker-revoke', NOW);
    const repositoryId = await createProvisionedRepository(applicationId);
    const job = await claimJobFor(applicationId, 'state-worker-revoke');
    const granted = await state.loadContext(
      job.id,
      'state-worker-revoke',
      job.requestId,
    );
    // 현재 TeamMember만이 authority다 — 신청자/리더 fallback이 섞이면 여기서 깨진다.
    expect(granted.currentMemberGithubLogins).toEqual([
      APPLICANT_LOGIN,
      GHOST_USER.login,
      MEMBER_USER.login,
    ]);
    expect(granted.membershipFingerprint).toBe(
      JSON.stringify([APPLICANT_LOGIN, GHOST_USER.login, MEMBER_USER.login]),
    );
    await state.prepareInvitations(
      job.id,
      'state-worker-revoke',
      job.requestId,
      repositoryId,
      granted.currentMemberGithubLogins,
    );
    await settleWork(
      job.id,
      'state-worker-revoke',
      job.requestId,
      repositoryId,
    );

    // When: 두 명이 팀을 떠난 뒤 다시 조정한다.
    await prisma.teamMember.deleteMany({
      where: {
        teamId: teamIdFor(applicationId),
        userId: { in: [MEMBER_USER.id, GHOST_USER.id] },
      },
    });
    const afterLeave = await state.loadContext(
      job.id,
      'state-worker-revoke',
      job.requestId,
    );
    expect(afterLeave.currentMemberGithubLogins).toEqual([APPLICANT_LOGIN]);
    await state.prepareInvitations(
      job.id,
      'state-worker-revoke',
      job.requestId,
      repositoryId,
      afterLeave.currentMemberGithubLogins,
    );
    const revokeWork = await state.findInvitationWork(
      job.id,
      'state-worker-revoke',
      job.requestId,
      repositoryId,
    );

    // Then: 남은 구성원은 건드리지 않고 탈퇴자만 회수 축으로, 그것도 먼저 나온다.
    expect(
      revokeWork.map((work) => [work.githubLogin, work.intent, work.status]),
    ).toEqual([
      [GHOST_USER.login, 'REVOKE', RepositoryInvitationStatus.REVOKE_REQUIRED],
      [MEMBER_USER.login, 'REVOKE', RepositoryInvitationStatus.REVOKE_REQUIRED],
    ]);
    await settleWork(
      job.id,
      'state-worker-revoke',
      job.requestId,
      repositoryId,
    );

    // And: 한 명만 실제로 다시 합류한다.
    await addTeamMember(applicationId, MEMBER_USER.id, 'member-rejoin');
    const afterRejoin = await state.loadContext(
      job.id,
      'state-worker-revoke',
      job.requestId,
    );
    await state.prepareInvitations(
      job.id,
      'state-worker-revoke',
      job.requestId,
      repositoryId,
      afterRejoin.currentMemberGithubLogins,
    );

    // Then: 재합류자만 부여 대기로 돌아오고, 돌아오지 않은 사람의 회수 이력 행은
    // 지워지지 않고 REVOKED로 남는다(초대 행은 사람당 한 건 그대로다).
    await expect(invitationRows(repositoryId)).resolves.toEqual([
      [APPLICANT_LOGIN, RepositoryInvitationStatus.SUCCEEDED, 0],
      [GHOST_USER.login, RepositoryInvitationStatus.REVOKED, 0],
      [MEMBER_USER.login, RepositoryInvitationStatus.PENDING, 0],
    ]);
    // And: 회수 이력 행은 매 사이클 재확인 대상으로 다시 나온다 — 만료된 worker의
    // 늦은 부여가 GitHub 쪽에만 살아남는 경로를 닫는다.
    const reverify = await state.findInvitationWork(
      job.id,
      'state-worker-revoke',
      job.requestId,
      repositoryId,
    );
    expect(
      reverify.map((work) => [work.githubLogin, work.intent, work.status]),
    ).toEqual([
      [GHOST_USER.login, 'REVOKE', RepositoryInvitationStatus.REVOKED],
      [MEMBER_USER.login, 'GRANT', RepositoryInvitationStatus.PENDING],
    ]);
    // And: 재확인은 멱등하다 — 같은 상태로 다시 닫아도 이력이 흔들리지 않는다.
    await state.completeInvitation({
      jobId: job.id,
      workerId: 'state-worker-revoke',
      requestId: job.requestId,
      invitationId: reverify[0]!.id,
      repositoryId,
      expectedStatus: RepositoryInvitationStatus.REVOKED,
      status: RepositoryInvitationStatus.REVOKED,
      now: NOW,
    });
    await expect(
      prisma.repositoryInvitation.findFirstOrThrow({
        where: { repositoryId, githubLogin: GHOST_USER.login },
      }),
    ).resolves.toMatchObject({
      status: RepositoryInvitationStatus.REVOKED,
      attemptCount: 0,
      reconciliationCount: 0,
    });
  });

  it('작업 중 멤버십이 바뀌었으면 job을 닫지 않고 재무장한다', async () => {
    // Given: 두 명의 멤버십 지문으로 작업을 시작했다.
    const applicationId = 'synthetic-worker-stale-membership';
    await createApplicationAndEvent(applicationId, [APPLICANT_LOGIN]);
    await addTeamMember(applicationId, MEMBER_USER.id, 'member');
    await outbox.consumeNext('outbox-worker-stale', NOW);
    const repositoryId = await createProvisionedRepository(applicationId);
    const job = await claimJobFor(applicationId, 'state-worker-stale');
    const context = await state.loadContext(
      job.id,
      'state-worker-stale',
      job.requestId,
    );
    const reconciliationAt = new Date(
      NOW.getTime() + DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
    );

    // When: GitHub 호출이 끝난 뒤, 완료 직전에 한 명이 탈퇴한다.
    await prisma.teamMember.deleteMany({
      where: { teamId: teamIdFor(applicationId), userId: MEMBER_USER.id },
    });
    await state.completeJob(
      job.id,
      'state-worker-stale',
      job.requestId,
      repositoryId,
      NOW,
      reconciliationAt,
      context.membershipFingerprint,
    );

    // Then: SUCCEEDED로 닫히지 않고 지금 실행 가능한 새 사이클로 돌아간다 —
    // 닫아 버리면 방금 탈퇴한 구성원의 접근이 다음 정기 사이클까지 살아있다.
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.PENDING,
      attemptCount: 0,
      nextAttemptAt: NOW,
      lockedBy: null,
      finishedAt: null,
    });

    // And: 지문이 맞는 다음 사이클은 정상적으로 닫힌다.
    const retry = await claimJobFor(applicationId, 'state-worker-stale-2');
    const fresh = await state.loadContext(
      retry.id,
      'state-worker-stale-2',
      retry.requestId,
    );
    await state.completeJob(
      retry.id,
      'state-worker-stale-2',
      retry.requestId,
      repositoryId,
      NOW,
      reconciliationAt,
      fresh.membershipFingerprint,
    );
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      nextAttemptAt: reconciliationAt,
    });
  });

  it('멤버십이 바뀐 뒤의 최종 실패는 job을 닫지 않고 재무장한다', async () => {
    // Given: 작업 도중 구성원이 바뀌었고 그 뒤 GitHub 호출이 최종 실패했다.
    const applicationId = 'synthetic-worker-final-failure-rearm';
    await createApplicationAndEvent(applicationId, [APPLICANT_LOGIN]);
    await addTeamMember(applicationId, MEMBER_USER.id, 'member');
    await outbox.consumeNext('outbox-worker-final-failure', NOW);
    const job = await claimJobFor(applicationId, 'state-worker-final');
    const context = await state.loadContext(
      job.id,
      'state-worker-final',
      job.requestId,
    );
    await prisma.teamMember.deleteMany({
      where: { teamId: teamIdFor(applicationId), userId: MEMBER_USER.id },
    });

    // When: 오래된 지문을 들고 최종 실패를 기록한다.
    await state.failJob({
      jobId: job.id,
      workerId: 'state-worker-final',
      requestId: job.requestId,
      final: true,
      errorCode: PROVISION_ERROR_CODES.INTERNAL,
      nextAttemptAt: NOW,
      now: NOW,
      expectedMembershipFingerprint: context.membershipFingerprint,
    });

    // Then: FAILED_FINAL로 닫히지 않는다 — outbox는 PROCESSING job의 lease를
    // 건드리지 않고 지나가므로, 여기서 닫으면 멤버십 변경 신호가 통째로 사라진다.
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.PENDING,
      attemptCount: 0,
      nextAttemptAt: NOW,
      lastErrorCode: null,
      lockedBy: null,
      finishedAt: null,
    });
  });

  it('늦게 도착한 부여 결과나 남의 lease는 회수 지시를 덮지 못한다', async () => {
    // Given: 부여 대기 행을 읽은 뒤 그 구성원이 팀을 떠났다.
    const applicationId = 'synthetic-worker-invitation-cas';
    await createApplicationAndEvent(applicationId, [APPLICANT_LOGIN]);
    await outbox.consumeNext('outbox-worker-cas', NOW);
    const repositoryId = await createProvisionedRepository(applicationId);
    const job = await claimJobFor(applicationId, 'state-worker-cas');
    await state.prepareInvitations(
      job.id,
      'state-worker-cas',
      job.requestId,
      repositoryId,
      [APPLICANT_LOGIN],
    );
    const [pending] = await state.findInvitationWork(
      job.id,
      'state-worker-cas',
      job.requestId,
      repositoryId,
    );
    await prisma.teamMember.deleteMany({
      where: { teamId: teamIdFor(applicationId) },
    });
    await state.prepareInvitations(
      job.id,
      'state-worker-cas',
      job.requestId,
      repositoryId,
      [],
    );

    // When/Then: 읽을 때의 상태가 아니므로 늦은 완료는 거부된다.
    await expect(
      state.completeInvitation({
        jobId: job.id,
        workerId: 'state-worker-cas',
        requestId: job.requestId,
        invitationId: pending!.id,
        repositoryId,
        expectedStatus: pending!.status,
        status: RepositoryInvitationStatus.SUCCEEDED,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(RepositoryProvisionLeaseLostError);
    // And: lease를 가지지 않은 worker는 아무 상태도 쓰지 못한다.
    await expect(
      state.failInvitation({
        jobId: job.id,
        workerId: 'state-worker-cas-intruder',
        requestId: job.requestId,
        invitationId: pending!.id,
        repositoryId,
        expectedStatus: RepositoryInvitationStatus.REVOKE_REQUIRED,
        intent: 'REVOKE',
        final: false,
        errorCode: PROVISION_ERROR_CODES.INTERNAL,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(RepositoryProvisionLeaseLostError);
    await expect(
      prisma.repositoryInvitation.findFirstOrThrow({ where: { repositoryId } }),
    ).resolves.toMatchObject({
      status: RepositoryInvitationStatus.REVOKE_REQUIRED,
      lastErrorCode: null,
      attemptCount: 0,
    });
  });
});

async function addTeamMember(
  applicationId: string,
  userId: string,
  suffix: string,
): Promise<void> {
  await prisma.teamMember.create({
    data: {
      id: `${applicationId}-team-member-${suffix}`,
      teamId: teamIdFor(applicationId),
      programId: programId(applicationId),
      userId,
    },
  });
}

/**
 * 조정 로직만 실 Postgres로 고정하기 위해 저장소 행은 직접 만든다 — 여기서 검증하는
 * 것은 GitHub 호출이 아니라 초대/회수 행의 전이와 job 재무장이다.
 */
async function createProvisionedRepository(
  applicationId: string,
): Promise<string> {
  const repository = await prisma.githubRepository.create({
    data: {
      applicationId,
      programId: programId(applicationId),
      teamId: teamIdFor(applicationId),
      githubRepositoryId:
        8_600_000_000n +
        BigInt(
          (APPLICATION_IDS as readonly string[]).indexOf(applicationId) + 1,
        ),
      nameWithOwner: `synthetic-org/${applicationId}`,
      visibility: RepositoryVisibility.PRIVATE,
      source: RepositorySource.ORG_PROVISIONED,
      presence: CollectionRepositoryPresence.PRESENT,
    },
  });
  return repository.id;
}

async function claimJobFor(
  applicationId: string,
  workerId: string,
): Promise<{ readonly id: string; readonly requestId: string }> {
  const job = await jobs.claimNext({
    workerId,
    now: NOW,
    leaseMs: 5 * 60_000,
  });
  if (job === null || job.applicationId !== applicationId) {
    throw new Error(`claimed unexpected job: ${job?.applicationId ?? 'none'}`);
  }
  return job;
}

/** 현재 일감을 그대로 성공 처리한다(부여는 SUCCEEDED, 회수는 REVOKED). */
async function settleWork(
  jobId: string,
  workerId: string,
  requestId: string,
  repositoryId: string,
): Promise<void> {
  for (const work of await state.findInvitationWork(
    jobId,
    workerId,
    requestId,
    repositoryId,
  )) {
    await state.completeInvitation({
      jobId,
      workerId,
      requestId,
      invitationId: work.id,
      repositoryId,
      expectedStatus: work.status,
      status:
        work.intent === 'REVOKE'
          ? RepositoryInvitationStatus.REVOKED
          : RepositoryInvitationStatus.SUCCEEDED,
      now: NOW,
    });
  }
}

async function invitationRows(
  repositoryId: string,
): Promise<readonly unknown[]> {
  const rows = await prisma.repositoryInvitation.findMany({
    where: { repositoryId },
    orderBy: { githubLogin: 'asc' },
  });
  return rows.map(({ githubLogin, status, attemptCount }) => [
    githubLogin,
    status,
    attemptCount,
  ]);
}

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
    organization: 'synthetic-org',
    findRepository: jest.fn().mockResolvedValue(null),
    createRepository: jest.fn((name: string, description: string) =>
      Promise.resolve(repositoryMetadata(name, description)),
    ),
    ensureCollaborator: jest
      .fn()
      .mockResolvedValue(COLLABORATOR_OUTCOMES.SUCCEEDED),
    revokeCollaborator: jest.fn().mockResolvedValue(undefined),
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
    nameWithOwner: `synthetic-org/${name}`,
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
  await prisma.$transaction(async (transaction) => {
    const event = await transaction.outboxEvent.create({
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
    await transferProvisionGeneration(
      transaction,
      { applicationId, newEventId: event.id, now: NOW },
      parseRepositoryProvisionEvent,
    );
  });
}

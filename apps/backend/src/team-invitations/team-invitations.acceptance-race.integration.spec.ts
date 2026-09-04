import {
  AccountStatus,
  AffiliationKind,
  MemberKind,
  ProgramCategory,
  RepositoryConnectionMode,
  TeamInvitationStatus,
  ProgramTrackType,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { ApplicationsRepository } from '../applications/applications.repository';
import { PrismaService } from '../prisma/prisma.service';
import {
  backendPid,
  deferred,
  pidCapturingPrisma,
  releaseAfterBlocked,
} from './team-invitations.acceptance-race.test-support';
import {
  TeamInvitationLockedError,
  TeamInvitationsRepository,
} from './team-invitations.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const TEST_PREFIX = 'team-invitation-acceptance-race:';
const PROGRAM_ID = `${TEST_PREFIX}program`;
const TEAM_ID = `${TEST_PREFIX}team`;
const INVITATION_ID = `${TEST_PREFIX}invitation`;
const LEADER_ID = `${TEST_PREFIX}leader`;
const INVITEE_ID = `${TEST_PREFIX}invitee`;
const prisma = new PrismaService();

async function seedFixture(): Promise<void> {
  await prisma.user.createMany({
    data: [
      {
        id: LEADER_ID,
        githubId: 9_301_000_001n,
        nickname: 'acceptance-race-leader',
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: INVITEE_ID,
        githubId: 9_301_000_002n,
        nickname: 'acceptance-race-invitee',
        accountStatus: AccountStatus.ACTIVE,
      },
    ],
  });
  await prisma.userProfile.createMany({
    data: [
      {
        userId: LEADER_ID,
        name: 'Synthetic user',
        studentId: '301001',
        department: 'Synthetic department',
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: 'Synthetic department',
      },
      {
        userId: INVITEE_ID,
        name: 'Synthetic user',
        studentId: '301002',
        department: 'Synthetic department',
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: 'Synthetic department',
      },
    ],
  });
  await prisma.program.create({
    data: {
      id: PROGRAM_ID,
      name: 'Invitation acceptance race program',
      organizer: 'Synthetic organizer',
      trackType: ProgramTrackType.CURRICULAR,
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
      description: 'Synthetic invitation acceptance race fixture',
      teamMinSize: 1,
      teamMaxSize: 4,
    },
  });
  await prisma.team.create({
    data: {
      id: TEAM_ID,
      programId: PROGRAM_ID,
      name: 'Acceptance race team',
      joinCodeDigest: `${TEST_PREFIX}digest`,
      leaderId: LEADER_ID,
    },
  });
  await prisma.teamMember.create({
    data: { teamId: TEAM_ID, programId: PROGRAM_ID, userId: LEADER_ID },
  });
  await prisma.teamInvitation.create({
    data: {
      id: INVITATION_ID,
      teamId: TEAM_ID,
      programId: PROGRAM_ID,
      inviteeId: INVITEE_ID,
      invitedById: LEADER_ID,
    },
  });
}

async function cleanup(): Promise<void> {
  await prisma.teamInvitation.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.application.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.teamMember.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.team.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
  await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
}

describe('Team invitation acceptance transaction races', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  beforeEach(async () => {
    await cleanup();
    await seedFixture();
  });
  afterEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it.each([
    [
      '역할 변경 트랜잭션',
      {
        hasStaffAccess: true,
        selectedMemberKind: MemberKind.STAFF,
        profile: {
          update: {
            memberKind: MemberKind.STAFF,
            studentId: null,
            affiliationKind: AffiliationKind.PROGRAM_OFFICE,
            department: 'Synthetic program office',
            affiliationName: 'Synthetic program office',
          },
        },
      },
    ],
    ['계정 비활성화 트랜잭션', { accountStatus: AccountStatus.DEACTIVATED }],
  ] as const)(
    '%s이 먼저 잠그면 수락은 대기 후 최신 자격을 본다',
    async (_, updateData) => {
      const updateBackend = backendPid();
      const acceptBackend = backendPid();
      const updated = deferred();
      const releaseUpdate = deferred();
      const update = pidCapturingPrisma(
        prisma,
        updateBackend.capture,
      ).$transaction(async (transaction) => {
        await transaction.user.update({
          where: { id: INVITEE_ID },
          data: updateData,
        });
        updated.resolve();
        await releaseUpdate.promise;
      });
      await updated.promise;

      const acceptance = new TeamInvitationsRepository(
        pidCapturingPrisma(prisma, acceptBackend.capture),
      ).withAcceptTransaction(INVITATION_ID, INVITEE_ID);
      await releaseAfterBlocked(
        prisma,
        acceptBackend.pid,
        updateBackend.pid,
        releaseUpdate,
        [update, acceptance],
      );

      const [, outcome] = await Promise.all([update, acceptance]);
      expect(outcome).toEqual({ kind: 'invitee-not-eligible' });
      await expectPendingWithoutMembership();
    },
  );

  it('신청 생성이 먼저 팀을 잠그면 수락은 대기 후 잠금을 본다', async () => {
    const applyBackend = backendPid();
    const acceptBackend = backendPid();
    const applicationCreated = deferred();
    const releaseApplication = deferred();
    const application = createPausedApplication(
      applyBackend.capture,
      applicationCreated,
      releaseApplication,
    );
    await applicationCreated.promise;

    const acceptance = new TeamInvitationsRepository(
      pidCapturingPrisma(prisma, acceptBackend.capture),
    ).withAcceptTransaction(INVITATION_ID, INVITEE_ID);
    await releaseAfterBlocked(
      prisma,
      acceptBackend.pid,
      applyBackend.pid,
      releaseApplication,
      [application, acceptance],
    );

    const [, outcome] = await Promise.all([application, acceptance]);
    expect(outcome).toEqual({ kind: 'team-locked' });
    await expectPendingWithoutMembership();
  });

  it('신청 생성이 먼저 팀을 잠그면 새 초대도 대기 후 거부된다', async () => {
    const applyBackend = backendPid();
    const inviteBackend = backendPid();
    const applicationCreated = deferred();
    const releaseApplication = deferred();
    const application = createPausedApplication(
      applyBackend.capture,
      applicationCreated,
      releaseApplication,
    );
    await applicationCreated.promise;

    const invitation = new TeamInvitationsRepository(
      pidCapturingPrisma(prisma, inviteBackend.capture),
    ).createInvitation({
      teamId: TEAM_ID,
      programId: PROGRAM_ID,
      inviteeId: INVITEE_ID,
      invitedById: LEADER_ID,
    });
    await releaseAfterBlocked(
      prisma,
      inviteBackend.pid,
      applyBackend.pid,
      releaseApplication,
      [application, invitation],
    );

    await application;
    await expect(invitation).rejects.toBeInstanceOf(TeamInvitationLockedError);
  });
});

function createPausedApplication(
  capturePid: (pid: number) => void,
  applicationCreated: ReturnType<typeof deferred>,
  releaseApplication: ReturnType<typeof deferred>,
): Promise<void> {
  const applications = new ApplicationsRepository(
    pidCapturingPrisma(prisma, capturePid),
    { TEAM_JOIN_CODE_SECRET: 'synthetic-acceptance-race-secret' },
  );
  return applications.withCreateTransaction(async (store) => {
    await store.lockProgramForApply(PROGRAM_ID);
    await store.lockTeamForApply(TEAM_ID);
    await store.createApplication({
      programId: PROGRAM_ID,
      applicantId: LEADER_ID,
      teamId: TEAM_ID,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
    });
    applicationCreated.resolve();
    await releaseApplication.promise;
  });
}

async function expectPendingWithoutMembership(): Promise<void> {
  const [invitation, membership] = await Promise.all([
    prisma.teamInvitation.findUniqueOrThrow({ where: { id: INVITATION_ID } }),
    prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: TEAM_ID, userId: INVITEE_ID } },
    }),
  ]);
  expect(invitation.status).toBe(TeamInvitationStatus.PENDING);
  expect(invitation.respondedAt).toBeNull();
  expect(membership).toBeNull();
}

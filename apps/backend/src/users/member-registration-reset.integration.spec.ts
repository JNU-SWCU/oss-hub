import { AuthRepository } from '../auth/auth.repository';
import { MemberOnboardingRepository } from './member-onboarding.repository';
import { MemberOnboardingService } from './member-onboarding.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { Prisma } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { AdminRepository } from './admin.repository';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { MemberRegistrationResetRepository } from './member-registration-reset.repository';
import { MemberRegistrationResetService } from './member-registration-reset.service';
import { UserProfileService } from './user-profile.service';
import { UserTransitionRepository } from './user-transition.repository';
import { UserHistoryRepository } from './user-history.repository';
import { TeamInvitationsRepository } from '../programs/team-invitations.repository';
import { TeamHistoryRepository } from '../programs/team-history.repository';
import { PlatformRepository } from '../platform/platform.repository';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const transitions = new UserTransitionRepository();
const profiles = new UserProfileService();
const access = new AdminAccessRepository(
  prisma,
  new AdminAccessHistoryRepository(),
  new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
  new AdminRepository(prisma),
  transitions,
);
const repository = new MemberRegistrationResetRepository(
  prisma,
  access,
  new PrismaSerializationRetryRepository(),
  transitions,
);
const audit = new UserHistoryRepository(transitions);
const service = new MemberRegistrationResetService(
  repository,
  audit,
  new HistoryMetadataService(),
  profiles,
  new AdminAccessMutationService(new HistoryMetadataService(), profiles),
);
let sequence = 0;
const at = new Date('2026-01-01T00:00:00.000Z');
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());
async function create(
  data: Omit<Prisma.UserCreateInput, 'id' | 'githubId' | 'nickname'> = {},
) {
  sequence++;
  return prisma.user.create({
    data: {
      id: 'test:member-kind:new:' + sequence,
      githubId: 9700700000n + BigInt(sequence),
      nickname: 'synthetic-' + sequence,
      type: 'STUDENT',
      name: 'Name',
      department: 'Department',
      departmentType: 'DEPARTMENT',
      profileCreatedAt: at,
      profileUpdatedAt: at,
      ...data,
      studentId:
        data.type === 'STAFF'
          ? null
          : (data.studentId ?? String(968600 + sequence)),
    },
    include: { admin: true },
  });
}
async function actor() {
  return create({ admin: { create: { origin: 'BOOTSTRAP' } } });
}
function expectState(user: {
  type: 'UNSELECTED' | 'STUDENT' | 'STAFF';
  approvalStatus:
    'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
  approvalRequestId: string | null;
}) {
  if (user.type === 'UNSELECTED')
    throw new TypeError('This test requires a selected type');
  return {
    expectedMemberKind: user.type,
    expectedApprovalStatus: user.approvalStatus,
    expectedApprovalRequestId: user.approvalRequestId,
  };
}
describe('registration reset persistence', () => {
  it.each(['actorId', 'inviteeId', 'invitedById'] as const)(
    '3b protects history-only activity through %s',
    async (field) => {
      const admin = await actor();
      const user = await create();
      const history = await prisma.teamHistory.create({
        data: {
          teamId: 'deleted-team',
          programId: 'deleted-program',
          actorId: field === 'actorId' ? user.id : null,
          event:
            field === 'actorId'
              ? 'INVITATION_CANCELLED'
              : 'INVITATION_ARCHIVED',
          source: field === 'actorId' ? 'APPLICATION' : 'MIGRATION',
          sourceTable: 'TeamInvitation',
          sourceId: `history-only-${user.id}`,
          data: {
            schemaVersion: 1,
            invitation: {
              id: `history-only-${user.id}`,
              inviteeId: field === 'inviteeId' ? user.id : 'other-invitee',
              invitedById: field === 'invitedById' ? user.id : 'other-inviter',
              createdAt: at.toISOString(),
              status: 'DECLINED',
              respondedAt: at.toISOString(),
              updatedAt: at.toISOString(),
            },
          },
        },
      });
      try {
        await expect(repository.hasActivity(prisma, user.id)).resolves.toBe(
          true,
        );
        await expect(
          service.resetFromRequest(admin.githubId, user.id, expectState(user)),
        ).rejects.toMatchObject({ errorCode: { code: 'ROL_025' } });
      } finally {
        await prisma.teamHistory.delete({ where: { id: history.id } });
      }
    },
  );

  it('protects registration reset after invitation decline deletes its row', async () => {
    const admin = await actor();
    const user = await create();
    const programId = `${user.id}:program`;
    const teamId = `${user.id}:team`;
    const invitationId = `${user.id}:invitation`;
    await prisma.program.create({
      data: {
        id: programId,
        name: 'Synthetic rollback program',
        organizer: 'Synthetic',
        category: 'BASIC',
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: at,
        applicationEndAt: new Date('2027-01-01'),
        startAt: at,
        endAt: new Date('2027-01-01'),
        description: 'Synthetic',
        teamMinSize: 1,
        teamMaxSize: 3,
      },
    });
    await prisma.team.create({
      data: {
        id: teamId,
        programId,
        name: 'Synthetic',
        leaderId: admin.id,
        applicantId: admin.id,
        answers: {},
        applicationTemplateVersion: 1,
      },
    });
    await prisma.teamInvitation.create({
      data: {
        id: invitationId,
        teamId,
        programId,
        inviteeId: user.id,
        invitedById: admin.id,
      },
    });
    const invitations = new TeamInvitationsRepository(
      new TeamHistoryRepository(),
      prisma,
      new PlatformRepository(),
    );

    await expect(
      invitations.declinePendingInvitationAsInvitee(invitationId, user.id, at),
    ).resolves.toEqual({ kind: 'ok' });

    await expect(repository.hasActivity(prisma, user.id)).resolves.toBe(true);
    await expect(
      service.resetFromRequest(admin.githubId, user.id, expectState(user)),
    ).rejects.toMatchObject({ errorCode: { code: 'ROL_025' } });
    await expect(
      prisma.user.findUnique({ where: { id: user.id } }),
    ).resolves.toMatchObject({ type: 'STUDENT', studentId: user.studentId });
    await expect(
      prisma.teamInvitation.findUnique({ where: { id: invitationId } }),
    ).resolves.toBeNull();
    await expect(
      prisma.teamHistory.count({ where: { sourceId: invitationId } }),
    ).resolves.toBe(1);
  });
  it('keeps the session identity, clears membership and returns staff re-registration to normal approval', async () => {
    const admin = await actor();
    const user = await create();
    await service.resetFromRequest(admin.githubId, user.id, expectState(user));
    expect(
      await new AuthRepository(prisma).findByGithubId(user.githubId),
    ).toMatchObject({
      id: user.id,
      sessionVersion: user.sessionVersion,
      memberKind: null,
      profileCreatedAt: null,
    });
    const consents = { requireCurrent: async () => {} };
    const onboarding = new MemberOnboardingService(
      new MemberOnboardingRepository(prisma, transitions),
      consents,
      profiles,
    );
    expect(await onboarding.selectMemberKind(user.githubId, 'STAFF')).toEqual({
      selectedMemberKind: 'STAFF',
      redirectTo: '/onboarding/profile',
    });
    const users = new UsersService(
      new UsersRepository(prisma, transitions),
      consents,
      audit,
      new HistoryMetadataService(),
      profiles,
    );
    await users.completeMyProfile(user.githubId, {
      name: 'Synthetic staff',
      department: 'Synthetic department',
      departmentType: 'PROGRAM_OFFICE',
    });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({
      type: 'STAFF',
      studentId: null,
      approvalStatus: 'PENDING',
      approvalDecidedById: null,
    });
  });
  it.each(['PENDING', 'APPROVED'] as const)(
    'clears %s approval and profile while preserving request history and one before-snapshot',
    async (approvalStatus) => {
      const admin = await actor();
      const user = await create({
        type: 'STAFF',
        approvalStatus,
        approvalRequestId: 'synthetic-reset-' + sequence,
        approvalRequestedAt: at,
        phone: '80000000001',
        staffNumber: 'synthetic-number',
      });
      await service.resetFromRequest(
        admin.githubId,
        user.id,
        expectState(user),
      );
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(stored).toMatchObject({
        type: 'UNSELECTED',
        approvalStatus: 'NOT_REQUIRED',
        approvalRequestId: null,
        name: null,
        department: null,
        departmentType: null,
        studentId: null,
        staffNumber: null,
        phone: null,
        profileCreatedAt: null,
        profileUpdatedAt: null,
        sessionVersion: user.sessionVersion,
      });
      const events = await prisma.userHistory.findMany({
        where: { userId: user.id },
      });
      expect(events.map((event) => event.event).sort()).toEqual(
        [
          approvalStatus === 'PENDING' ? 'REQUEST_SUPERSEDED' : 'REVOKED',
          'TYPE_CHANGED',
        ].sort(),
      );
      expect(
        events.find((event) => event.event === 'TYPE_CHANGED')?.data,
      ).toMatchObject({
        beforeProfile: {
          name: user.name,
          phone: user.phone,
          staffNumber: user.staffNumber,
        },
        metadata: { command: 'RESET_MEMBER_KIND' },
      });
      const requests =
        await new AdminAccessHistoryRepository().listAdminAccessStaffAccessRequestHistory(
          prisma,
          user.id,
          { page: 1, limit: 20 },
        );
      expect(requests.items[0]).toMatchObject({
        id: user.approvalRequestId,
        status: 'REVOKED',
      });
    },
  );
  it('permits exactly one of two competing reset transactions', async () => {
    const admin = await actor();
    const user = await create();
    const results = await Promise.allSettled([
      service.resetFromRequest(admin.githubId, user.id, expectState(user)),
      service.resetFromRequest(admin.githubId, user.id, expectState(user)),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(await prisma.userHistory.count({ where: { userId: user.id } })).toBe(
      1,
    );
  });
  it('rolls back reset and request supersession when audit writing fails', async () => {
    const admin = await actor();
    const user = await create({
      type: 'STAFF',
      approvalStatus: 'PENDING',
      approvalRequestId: 'synthetic-rollback-' + sequence,
      approvalRequestedAt: at,
    });
    const failing = new MemberRegistrationResetService(
      repository,
      { record: jest.fn().mockRejectedValue(new Error('synthetic failure')) },
      new HistoryMetadataService(),
      profiles,
      new AdminAccessMutationService(new HistoryMetadataService(), profiles),
    );
    await expect(
      failing.resetFromRequest(admin.githubId, user.id, expectState(user)),
    ).rejects.toThrow('synthetic failure');
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toEqual(userWithoutAdmin(user));
    expect(await prisma.userHistory.count({ where: { userId: user.id } })).toBe(
      0,
    );
  });
  it('rejects a non-student studentId at the database boundary', async () => {
    await expect(
      create({ type: 'STAFF', approvalStatus: 'PENDING' }).then((user) =>
        prisma.user.update({
          where: { id: user.id },
          data: { studentId: '923499' },
        }),
      ),
    ).rejects.toThrow();
  });
});
function userWithoutAdmin(
  user: Prisma.UserGetPayload<{
    include: {
      admin: true;
    };
  }>,
) {
  const { admin, ...row } = user;
  void admin;
  return row;
}

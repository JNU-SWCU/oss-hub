import { Prisma } from '@prisma/client';
import { buildRow } from '../auth/auth.repository.spec-support';
import { PrismaService } from '../platform/prisma.service';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { MemberRegistrationResetRepository } from './member-registration-reset.repository';
function harness() {
  let row = buildRow({
    id: 'target',
    type: 'STUDENT',
    phone: '80000000001',
    name: 'Synthetic',
    studentId: '923451',
    department: 'Synthetic department',
    departmentType: 'DEPARTMENT',
    profileCreatedAt: new Date('2026-01-01'),
    profileUpdatedAt: new Date('2026-01-01'),
  });
  const history = jest
    .fn<Promise<unknown>, [Prisma.UserHistoryCreateArgs]>()
    .mockResolvedValue({});
  const count = jest
    .fn<Promise<number>, [Prisma.UserCountArgs]>()
    .mockResolvedValue(0);
  const prisma = Object.assign(new PrismaService(), {
    user: {
      count,
      findUnique: () => Promise.resolve(row),
      updateMany: jest
        .fn()
        .mockImplementation(
          (args: { where: Partial<typeof row>; data: Partial<typeof row> }) => {
            const matches = Object.entries(args.where).every(
              ([key, value]) => Reflect.get(row, key) === value,
            );
            if (matches) row = { ...row, ...args.data };
            return Promise.resolve({ count: matches ? 1 : 0 });
          },
        ),
    },
    userHistory: { create: history },
    $queryRaw: jest.fn().mockResolvedValue([]),
  });
  const transaction = jest
    .fn()
    .mockImplementation(
      (operation: (client: typeof prisma) => Promise<unknown>) =>
        operation(prisma),
    );
  Object.assign(prisma, { $transaction: transaction });
  const transitions = new UserTransitionRepository();
  const access = new AdminAccessRepository(
    prisma,
    new AdminAccessHistoryRepository(),
    new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
    new AdminRepository(prisma),
    transitions,
  );
  return {
    repository: new MemberRegistrationResetRepository(
      prisma,
      access,
      new PrismaSerializationRetryRepository(),
      transitions,
    ),
    prisma,
    count,
    history,
    transaction,
    row: () => row,
    setRow: (next: typeof row) => {
      row = next;
    },
  };
}
it.each([
  ['Application.applicantId', 'applications'],
  ['Application.processedById', 'processedApplications'],
  ['ApplicationReviewHistory.actorId', 'applicationReviewHistories'],
  ['Team.leaderId', 'ledTeams'],
  ['TeamMember.userId', 'teamMemberships'],
  ['TeamInvitation.inviteeId', 'receivedTeamInvitations'],
  ['TeamInvitation.invitedById', 'sentTeamInvitations'],
  ['ApplicationPreparation.leaderId', 'applicationPreparations'],
  ['ApplicationPreparationParticipant.userId', 'preparationParticipants'],
  ['SubmissionFile.uploaderId', 'uploadedFiles'],
  ['MilestoneDocumentSubmission.submittedById', 'milestoneDocumentSubmissions'],
  [
    'MilestoneDocumentSubmissionHistory.actorId',
    'milestoneDocumentSubmissionHistories',
  ],
  [
    'MilestoneDocumentReviewHistory.reviewerId',
    'milestoneDocumentReviewHistories',
  ],
  [
    'MilestoneDocumentTemplateFile.uploadedById',
    'uploadedMilestoneDocumentTemplateFiles',
  ],
  ['ProgramAuthoringUpload.actorId', 'programAuthoringUploads'],
  ['ProgramCreateRequest.actorId', 'programCreateRequests'],
  ['User.approvalDecidedById', 'approvalDecisions'],
  ['Admin.grantedById', 'adminGrants'],
] as const)('blocks activity through %s', async (_, relation) => {
  const h = harness();
  h.count.mockImplementation((args) =>
    Promise.resolve(
      args.where?.id === 'target' &&
        Array.isArray(args.where.OR) &&
        args.where.OR.some((clause) => Reflect.has(clause, relation))
        ? 1
        : 0,
    ),
  );
  expect(await h.repository.hasActivity(h.prisma, 'target')).toBe(true);
});
it('does not treat social, consent or history-only records as activity', async () => {
  const h = harness();
  h.count.mockImplementation((args) =>
    Promise.resolve(
      Array.isArray(args.where?.OR) &&
        args.where.OR.some((clause) =>
          [
            'boardPosts',
            'boardComments',
            'notifications',
            'loginHistories',
            'policies',
            'userHistories',
            'actedUserHistories',
            'adminHistories',
            'actedAdminHistories',
          ].some((relation) => Reflect.has(clause, relation)),
        )
        ? 1
        : 0,
    ),
  );
  expect(await h.repository.hasActivity(h.prisma, 'target')).toBe(false);
});
it.each(['PENDING', 'APPROVED'] as const)(
  'clears all profile and approval fields and closes %s in RepeatableRead',
  async (approvalStatus) => {
    const h = harness();
    h.setRow({
      ...h.row(),
      type: 'STAFF',
      studentId: null,
      approvalStatus,
      approvalRequestId: 'request',
      approvalRequestedAt: new Date('2026-01-01'),
    });
    await h.repository.withTransaction(async (store) => {
      const target = await store.findTargetForUpdate('target');
      if (!target) throw new Error('Missing fixture');
      expect(await store.resetRegistration(target, 'actor')).toBe(true);
    });
    expect(h.row()).toMatchObject({
      type: 'UNSELECTED',
      name: null,
      studentId: null,
      phone: null,
      staffNumber: null,
      department: null,
      departmentType: null,
      profileCreatedAt: null,
      profileUpdatedAt: null,
      approvalStatus: 'NOT_REQUIRED',
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
      sessionVersion: 0,
    });
    const recorded: unknown = h.history.mock.calls[0]?.[0];
    expect(recorded).toMatchObject({
      data: {
        event: approvalStatus === 'PENDING' ? 'REQUEST_SUPERSEDED' : 'REVOKED',
        actorId: 'actor',
        data: { request: { id: 'request', status: 'REVOKED' } },
      },
    });
    expect(h.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  },
);
it('does not write a request history when the conditional update loses', async () => {
  const h = harness();
  await h.repository.withTransaction(async (store) => {
    const target = await store.findTargetForUpdate('target');
    if (!target) throw new Error('Missing fixture');
    h.setRow({ ...h.row(), type: 'STAFF', approvalStatus: 'PENDING' });
    expect(await store.resetRegistration(target, 'actor')).toBe(false);
  });
  expect(h.history).not.toHaveBeenCalled();
});

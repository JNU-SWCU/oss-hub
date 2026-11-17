import type { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { UserHistoryRepository } from './user-history.repository';
import { UserTransitionRepository } from './user-transition.repository';
import type {
  ApprovalRecord,
  RequestSnapshot,
  UserAuditInput,
} from './user-history.types';

const metadata = new HistoryMetadataService();
const person = { displayName: 'Synthetic', githubLogin: 'synthetic' };
const requestedAt = '2026-01-02T00:00:00.000Z';
const decidedAt = '2026-01-03T00:00:00.000Z';
const original: RequestSnapshot = {
  id: 'request-revoked',
  userId: 'target',
  status: 'REVOKED',
  createdAt: requestedAt,
  decidedAt,
  decidedById: 'old-decider',
  rejectionReason: null,
};

function input(
  kind: 'account' | 'profile' | 'phone' | 'admin' | 'approval',
): UserAuditInput {
  const base = { actorGithubId: 1n, targetType: 'USER', targetId: 'target' };
  switch (kind) {
    case 'account':
      return {
        ...base,
        action: 'USER_ACCOUNT_STATUS_CHANGED',
        metadata: metadata.createAccessAuditMetadata({
          eventKind: 'ACCOUNT_STATUS_CHANGED',
          actor: person,
          target: person,
          before: {
            role: 'STAFF',
            accountStatus: 'DEACTIVATED',
            requestStatus: null,
          },
          after: {
            role: 'STAFF',
            accountStatus: 'ACTIVE',
            requestStatus: null,
          },
        }),
      };
    case 'profile':
      return {
        ...base,
        action: 'USER_PROFILE_UPDATED',
        metadata: metadata.createUserProfileAuditMetadata({
          actor: person,
          target: person,
          changes: [{ field: 'name', before: 'Before', after: 'After' }],
        }),
      };
    case 'phone':
      return {
        ...base,
        action: 'USER_PHONE_UPDATED',
        metadata: metadata.createUserPhoneAuditMetadata({
          actor: person,
          target: person,
          transition: 'SET',
        }),
      };
    case 'admin':
      return {
        ...base,
        action: 'GRANT_ADMIN_ACCESS',
        metadata: metadata.createIndependentAuthorityAuditMetadata({
          command: 'GRANT_ADMIN_ACCESS',
          actor: person,
          target: person,
          before: {
            role: 'STAFF',
            memberKind: 'STAFF',
            hasStaffAccess: true,
            hasAdminAccess: false,
            accountStatus: 'ACTIVE',
          },
          after: {
            role: 'ADMIN',
            memberKind: 'STAFF',
            hasStaffAccess: true,
            hasAdminAccess: true,
            accountStatus: 'ACTIVE',
          },
        }),
      };
    case 'approval':
      return {
        ...base,
        action: 'STAFF_ROLE_REQUEST_APPROVED',
        targetType: 'ROLE_REQUEST',
        targetId: original.id,
        metadata: metadata.createAccessAuditMetadata({
          eventKind: 'ROLE_REQUEST_APPROVED',
          actor: person,
          target: person,
          before: {
            role: null,
            accountStatus: 'ACTIVE',
            requestStatus: 'PENDING',
          },
          after: {
            role: 'STAFF',
            accountStatus: 'ACTIVE',
            requestStatus: 'APPROVED',
          },
        }),
      };
  }
}

function writerHarness(hasDecision = false) {
  const current: ApprovalRecord = {
    id: 'target',
    type: 'STAFF',
    approvalStatus: 'APPROVED',
    approvalRequestId: original.id,
    approvalRequestedAt: new Date(requestedAt),
    approvalDecidedAt: hasDecision ? new Date('2026-02-01') : null,
    approvalDecidedById: hasDecision ? 'actor' : null,
    approvalReason: null,
  };
  const userCreate = jest.fn().mockResolvedValue({});
  const adminCreate = jest.fn().mockResolvedValue({});
  const transaction = Object.assign(new PrismaService(), {
    user: {
      findUniqueOrThrow: jest
        .fn()
        .mockImplementation((args: Prisma.UserFindUniqueArgs) =>
          Promise.resolve(
            args.where.githubId !== undefined ? { id: 'actor' } : current,
          ),
        ),
    },
    userHistory: { create: userCreate },
    adminHistory: { create: adminCreate },
  });
  return {
    writer: new UserHistoryRepository(new UserTransitionRepository()),
    transaction,
    userCreate,
    adminCreate,
  };
}

it.each(['account', 'profile', 'phone', 'admin'] as const)(
  '%s history does not snapshot normalized current approval as a request decision',
  async (kind) => {
    const h = writerHarness();
    await h.writer.record(input(kind), h.transaction);
    const create = kind === 'admin' ? h.adminCreate : h.userCreate;
    const eventData: unknown = expect.objectContaining({ request: null });
    const historyData: unknown = expect.objectContaining({ data: eventData });
    expect(create).toHaveBeenCalledWith({ data: historyData });
  },
);

it('captures the current request only for an actual approval decision', async () => {
  const h = writerHarness(true);
  await h.writer.record(input('approval'), h.transaction);
  const request: unknown = expect.objectContaining({
    id: original.id,
    status: 'APPROVED',
    decidedById: 'actor',
    decidedAt: '2026-02-01T00:00:00.000Z',
  });
  const eventData: unknown = expect.objectContaining({ request });
  const historyData: unknown = expect.objectContaining({
    event: 'APPROVED',
    data: eventData,
  });
  expect(h.userCreate).toHaveBeenCalledWith({ data: historyData });
});

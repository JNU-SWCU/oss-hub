import type { Prisma, UserHistoryEvent } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { UserHistoryRepository } from './user-history.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import type {
  ApprovalRecord,
  RequestSnapshot,
  UserAuditInput,
} from './user-history.types';

const metadata = new AuditLogMetadataService();
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

type HistoryRow = {
  readonly event: UserHistoryEvent;
  readonly data: Prisma.InputJsonValue;
};

function imported(request: RequestSnapshot): HistoryRow {
  return {
    event: 'LEGACY_IMPORT',
    data: {
      schemaVersion: 1,
      recordKind: 'REQUEST_SNAPSHOT',
      original: request,
    },
  };
}

async function readHistory(rows: readonly HistoryRow[]) {
  const prisma = Object.assign(new PrismaService(), {
    userHistory: { findMany: jest.fn().mockResolvedValue(rows) },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'old-decider', nickname: 'old-decider' },
        { id: 'actor', nickname: 'actor' },
      ]),
    },
  });
  return new AdminAccessHistoryRepository().listAdminAccessStaffAccessRequestHistory(
    prisma,
    'target',
    { page: 1, limit: 20 },
  );
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

it.each([
  ['account', 'ACCOUNT_STATUS_CHANGED'],
  ['profile', 'PROFILE_UPDATED'],
  ['phone', 'PHONE_UPDATED'],
] as const)(
  '%s events cannot overwrite imported APPROVED and REVOKED request facts',
  async (kind, event) => {
    const change = input(kind);
    const result = await readHistory([
      imported({
        ...original,
        id: 'request-approved',
        status: 'APPROVED',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      imported(original),
      {
        event,
        data: {
          schemaVersion: 1,
          recordKind: 'DOMAIN_EVENT',
          action: change.action,
          targetType: change.targetType,
          targetId: change.targetId,
          metadata: change.metadata,
          request: {
            ...original,
            status: 'APPROVED',
            decidedAt: null,
            decidedById: null,
          },
        },
      },
    ]);
    expect(result.items.map((request) => request.status)).toEqual([
      'REVOKED',
      'APPROVED',
    ]);
    expect(result.items[0]).toMatchObject({
      id: original.id,
      decidedAt: new Date(decidedAt),
      decidedBy: 'old-decider',
    });
  },
);

it('still folds an actual approval decision over the same imported pending request', async () => {
  const decision = input('approval');
  const result = await readHistory([
    imported({
      ...original,
      status: 'PENDING',
      decidedAt: null,
      decidedById: null,
    }),
    {
      event: 'APPROVED',
      data: {
        schemaVersion: 1,
        recordKind: 'DOMAIN_EVENT',
        action: decision.action,
        targetType: decision.targetType,
        targetId: decision.targetId,
        metadata: decision.metadata,
        request: {
          ...original,
          status: 'APPROVED',
          decidedAt: '2026-02-01T00:00:00.000Z',
          decidedById: 'actor',
        },
      },
    },
  ]);
  expect(result.total).toBe(1);
  expect(result.items[0]).toMatchObject({
    status: 'APPROVED',
    decidedBy: 'actor',
  });
});

it('still folds real typed request creation and supersession events', async () => {
  const result = await readHistory([
    {
      event: 'APPROVAL_REQUESTED',
      data: {
        schemaVersion: 1,
        recordKind: 'REQUEST_TRANSITION',
        request: {
          ...original,
          status: 'PENDING',
          decidedAt: null,
          decidedById: null,
        },
      },
    },
    {
      event: 'REQUEST_SUPERSEDED',
      data: {
        schemaVersion: 1,
        recordKind: 'REQUEST_TRANSITION',
        cause: 'SUPERSEDED',
        replacementRequestId: 'replacement',
        request: {
          ...original,
          decidedAt: '2026-02-01T00:00:00.000Z',
          decidedById: 'actor',
        },
      },
    },
  ]);
  expect(result.total).toBe(1);
  expect(result.items[0]).toMatchObject({
    status: 'REVOKED',
    decidedBy: 'actor',
  });
});

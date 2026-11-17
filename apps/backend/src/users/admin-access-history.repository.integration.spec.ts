import type { Prisma, UserHistoryEvent } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import type { RequestSnapshot } from './user-history.types';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new AdminAccessHistoryRepository();
const PREFIX = 'admin-access-history-it';
const DECIDER_LABEL = `${PREFIX}-decider`;
const ACTOR_LABEL = `${PREFIX}-actor`;
const runId = Date.now().toString(36);
const DECIDER = `${DECIDER_LABEL}-${runId}`;
const ACTOR = `${ACTOR_LABEL}-${runId}`;

let target = '';

const original: RequestSnapshot = {
  id: `${PREFIX}-request-revoked`,
  userId: 'target',
  status: 'REVOKED',
  createdAt: '2026-01-02T00:00:00.000Z',
  decidedAt: '2026-01-03T00:00:00.000Z',
  decidedById: DECIDER,
  rejectionReason: null,
};

let sequence = 0;

function imported(request: RequestSnapshot) {
  return event('LEGACY_IMPORT', {
    schemaVersion: 1,
    recordKind: 'REQUEST_SNAPSHOT',
    original: { ...request },
  });
}

function event(name: UserHistoryEvent, data: Prisma.InputJsonObject) {
  sequence += 1;
  return {
    userId: target,
    event: name,
    source: 'APPLICATION' as const,
    occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
    recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
    data,
  };
}

async function record(
  rows: readonly ReturnType<typeof event>[],
): Promise<void> {
  await prisma.userHistory.createMany({ data: [...rows] });
}

async function read(page = 1, limit = 20) {
  return repository.listAdminAccessStaffAccessRequestHistory(prisma, target, {
    page,
    limit,
  });
}

const run = runId;
let userIndex = 0;

beforeAll(async () => {
  await prisma.$connect();
  await prisma.user.createMany({
    data: [DECIDER, ACTOR].map((id, index) => ({
      id,
      githubId:
        8_963_000_000_000n +
        BigInt(Date.now() % 1_000_000) * 100n +
        BigInt(index),
      nickname: id,
    })),
  });
});

beforeEach(async () => {
  userIndex += 1;
  target = `${PREFIX}-target-${run}-${userIndex}`;
  await prisma.user.create({
    data: {
      id: target,
      githubId:
        8_963_000_000_000n +
        BigInt(Date.now() % 1_000_000) * 100n +
        10n +
        BigInt(userIndex),
      nickname: target,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

it.each([
  'ACCOUNT_STATUS_CHANGED',
  'PROFILE_UPDATED',
  'PHONE_UPDATED',
] as const)(
  '%s events cannot overwrite imported APPROVED and REVOKED request facts',
  async (name) => {
    await record([
      imported({
        ...original,
        id: `${PREFIX}-request-approved`,
        status: 'APPROVED',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      imported(original),
      event(name, {
        schemaVersion: 1,
        recordKind: 'DOMAIN_EVENT',
        request: {
          ...original,
          status: 'APPROVED',
          decidedAt: null,
          decidedById: null,
        },
      }),
    ]);

    const result = await read();

    expect(result.items.map((request) => request.status)).toEqual([
      'REVOKED',
      'APPROVED',
    ]);
    expect(result.items[0]).toMatchObject({
      id: original.id,
      decidedAt: new Date(original.decidedAt ?? ''),
      decidedBy: DECIDER,
    });
  },
);

it('folds an actual approval decision over the same imported pending request', async () => {
  await record([
    imported({
      ...original,
      status: 'PENDING',
      decidedAt: null,
      decidedById: null,
    }),
    event('APPROVED', {
      schemaVersion: 1,
      recordKind: 'DOMAIN_EVENT',
      request: {
        ...original,
        status: 'APPROVED',
        decidedAt: '2026-02-01T00:00:00.000Z',
        decidedById: ACTOR,
      },
    }),
  ]);

  const result = await read();

  expect(result.total).toBe(1);
  expect(result.items[0]).toMatchObject({
    status: 'APPROVED',
    decidedBy: ACTOR,
  });
});

it('folds typed request creation and supersession events', async () => {
  await record([
    event('APPROVAL_REQUESTED', {
      schemaVersion: 1,
      recordKind: 'REQUEST_TRANSITION',
      request: {
        ...original,
        status: 'PENDING',
        decidedAt: null,
        decidedById: null,
      },
    }),
    event('REQUEST_SUPERSEDED', {
      schemaVersion: 1,
      recordKind: 'REQUEST_TRANSITION',
      request: {
        ...original,
        decidedAt: '2026-02-01T00:00:00.000Z',
        decidedById: ACTOR,
      },
    }),
  ]);

  const result = await read();

  expect(result.total).toBe(1);
  expect(result.items[0]).toMatchObject({
    status: 'REVOKED',
    decidedBy: ACTOR,
  });
});

it('returns the first page even when the user has many unrelated history events', async () => {
  await record([
    ...Array.from({ length: 51 }, () =>
      event('PROFILE_UPDATED', {
        schemaVersion: 1,
        recordKind: 'DOMAIN_EVENT',
      }),
    ),
    imported(original),
  ]);

  const result = await read(1, 10);

  expect(result.total).toBe(1);
  expect(result.items).toHaveLength(1);
});

it('pages requests newest first in the database', async () => {
  await record(
    Array.from({ length: 25 }, (_, index) =>
      imported({
        ...original,
        id: `${PREFIX}-request-${String(index).padStart(2, '0')}`,
        createdAt: new Date(Date.UTC(2026, 1, 1, 0, index)).toISOString(),
      }),
    ),
  );

  const second = await read(2, 10);

  expect(second.total).toBe(25);
  expect(second.items.map((request) => request.id)).toEqual(
    Array.from(
      { length: 10 },
      (_, index) => `${PREFIX}-request-${String(14 - index).padStart(2, '0')}`,
    ),
  );
});

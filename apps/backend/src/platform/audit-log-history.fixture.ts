import { Prisma } from '@prisma/client';
import type { PrismaService } from './prisma.service';

export const HISTORY_FEED_PREFIX = 'test:audit-history:';
export const HISTORY_FEED_DAY = '2091-01-01';
const actorId = `${HISTORY_FEED_PREFIX}actor`;
const userId = `${HISTORY_FEED_PREFIX}user`;

const HISTORY_PEOPLE_METADATA = {
  schemaVersion: 1,
  actor: { displayName: 'Original actor', githubLogin: 'original-actor' },
  target: { displayName: 'Original target', githubLogin: 'original-target' },
  changes: [{ field: 'name', before: 'Before', after: 'After' }],
};

export async function seedHistoryFeed(prisma: PrismaService): Promise<void> {
  await prisma.user.createMany({
    data: [
      {
        id: actorId,
        githubId: 9_501_101_001n,
        nickname: 'audit-history-actor',
      },
      {
        id: userId,
        githubId: 9_501_101_002n,
        nickname: 'audit-history-target',
      },
    ],
  });
  const originals = [
    {
      number: 1,
      action: 'PROGRAM_CREATED',
      targetType: 'PROGRAM',
      targetId: 'deleted-program',
      metadata: { schemaVersion: 1, programName: 'Original program' },
    },
    {
      number: 2,
      action: 'USER_PROFILE_UPDATED',
      targetType: 'USER',
      targetId: 'unresolved-user',
      metadata: { schemaVersion: 99, secret: 'unresolved raw' },
    },
    {
      number: 3,
      action: 'USER_ROLE_CHANGED',
      targetType: 'USER',
      targetId: userId,
      metadata: {
        schemaVersion: 2,
        eventKind: 'DIRECT_ROLE_CHANGED',
        actor: HISTORY_PEOPLE_METADATA.actor,
        target: HISTORY_PEOPLE_METADATA.target,
        before: { role: 'STAFF', accountStatus: 'ACTIVE', requestStatus: null },
        after: { role: 'ADMIN', accountStatus: 'ACTIVE', requestStatus: null },
      },
    },
    {
      number: 4,
      action: 'USER_PHONE_UPDATED',
      targetType: 'USER',
      targetId: userId,
      metadata: { unrecognized: 'original raw' },
    },
  ];
  for (const original of originals) {
    const row = {
      id: `${HISTORY_FEED_PREFIX}audit:${original.number}`,
      actorId,
      action: original.action,
      targetType: original.targetType,
      targetId: original.targetId,
      metadata: original.metadata,
      occurredAt: new Date(`${HISTORY_FEED_DAY}T00:00:04.000Z`),
    };
    if (original.number === 1) {
      await prisma.programHistory.create({
        data: {
          id: `program-audit:${row.id}`,
          programId: original.targetId,
          actorId,
          event: 'CREATED',
          occurredAt: row.occurredAt,
          source: 'MIGRATION',
          sourceTable: 'AuditLog',
          sourceId: row.id,
          data: { schemaVersion: 1, metadata: original.metadata },
        },
      });
    } else {
      const data = {
        schemaVersion: 1,
        recordKind: 'AUDIT_EVENT',
        canonicalEventId: row.id,
        original: row,
      };
      await prisma.$executeRaw`
        INSERT INTO "UserHistory" ("id", "userId", "actorId", "event",
          "occurredAt", "recordedAt", "source", "sourceTable", "sourceId", "sourcePart", "data")
        VALUES (${`migration:user:${row.id}`}, ${userId}, ${actorId}, 'LEGACY_IMPORT',
          ${row.occurredAt}, now(), 'MIGRATION', 'AuditLog', ${row.id},
          ${original.number === 3 ? 'user' : 'whole'}, ${JSON.stringify(data)}::jsonb)`;
      if (original.number === 3) {
        await prisma.$executeRaw`
          INSERT INTO "AdminHistory" ("id", "userId", "actorId", "event",
            "occurredAt", "recordedAt", "source", "sourceTable", "sourceId", "sourcePart", "data")
          VALUES (${`migration:admin:${row.id}`}, ${userId}, ${actorId}, 'LEGACY_IMPORT',
            ${row.occurredAt}, now(), 'MIGRATION', 'AuditLog', ${row.id},
            'admin', ${JSON.stringify(data)}::jsonb)`;
      }
    }
  }
  const request = {
    id: `${HISTORY_FEED_PREFIX}request`,
    userId,
    status: 'REVOKED',
    createdAt: `${HISTORY_FEED_DAY}T00:00:00.000Z`,
    decidedAt: `${HISTORY_FEED_DAY}T00:00:07.000Z`,
    decidedById: actorId,
    rejectionReason: 'private reason',
  };
  const runtime = [
    {
      number: 5,
      table: 'AdminHistory',
      event: 'GRANTED',
      recordKind: 'DOMAIN_EVENT',
      data: {
        action: 'GRANT_ADMIN_ACCESS',
        targetType: 'USER',
        targetId: userId,
        metadata: {
          schemaVersion: 2,
          eventKind: 'INDEPENDENT_AUTHORITY_CHANGED',
          command: 'GRANT_ADMIN_ACCESS',
          actor: HISTORY_PEOPLE_METADATA.actor,
          target: HISTORY_PEOPLE_METADATA.target,
          before: {
            memberKind: 'STAFF',
            hasStaffAccess: true,
            hasAdminAccess: false,
            role: 'STAFF',
            accountStatus: 'ACTIVE',
          },
          after: {
            memberKind: 'STAFF',
            hasStaffAccess: true,
            hasAdminAccess: true,
            role: 'ADMIN',
            accountStatus: 'ACTIVE',
          },
        },
        request: null,
      },
    },
    {
      number: 6,
      table: 'UserHistory',
      event: 'PROFILE_UPDATED',
      recordKind: 'DOMAIN_EVENT',
      data: {
        action: 'USER_PROFILE_UPDATED',
        targetType: 'USER',
        targetId: userId,
        metadata: HISTORY_PEOPLE_METADATA,
        request: null,
      },
    },
    {
      number: 7,
      table: 'UserHistory',
      event: 'REQUEST_SUPERSEDED',
      recordKind: 'REQUEST_TRANSITION',
      data: {
        request,
        cause: 'SUPERSEDED',
        replacementRequestId: 'request-new',
      },
    },
    {
      number: 8,
      table: 'UserHistory',
      event: 'SIGNED_UP',
      recordKind: 'SIGNUP',
      data: {},
    },
    {
      number: 9,
      table: 'AdminHistory',
      event: 'GRANTED',
      recordKind: 'BOOTSTRAP',
      data: { operatorReceipt: 'private operator receipt' },
    },
  ] as const;
  for (const row of runtime) {
    const table =
      row.table === 'UserHistory'
        ? Prisma.sql`"UserHistory"`
        : Prisma.sql`"AdminHistory"`;
    const eventType =
      row.table === 'UserHistory'
        ? Prisma.sql`"UserHistoryEvent"`
        : Prisma.sql`"AdminHistoryEvent"`;
    const namespace = row.table === 'UserHistory' ? 'user' : 'admin';
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${table} ("id", "userId", "actorId", "event", "occurredAt", "recordedAt", "source", "data")
      VALUES (${`${namespace}:${HISTORY_FEED_PREFIX}${row.number}`}, ${userId}, ${actorId},
        ${row.event}::${eventType}, ${new Date(`${HISTORY_FEED_DAY}T00:00:0${row.number}.000Z`)},
        now(), ${row.recordKind === 'BOOTSTRAP' ? 'BOOTSTRAP' : 'APPLICATION'}::"HistorySource",
        ${JSON.stringify({ schemaVersion: 1, recordKind: row.recordKind, ...row.data })}::jsonb)`);
  }
  for (const recordKind of [
    'USER_SNAPSHOT',
    'REQUEST_SNAPSHOT',
    'ADMIN_SNAPSHOT',
  ]) {
    const table =
      recordKind === 'ADMIN_SNAPSHOT'
        ? Prisma.sql`"AdminHistory"`
        : Prisma.sql`"UserHistory"`;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${table} ("id", "userId", "event", "occurredAt", "recordedAt", "source", "data")
      VALUES (${`${HISTORY_FEED_PREFIX}${recordKind}`}, ${userId}, 'LEGACY_IMPORT',
        ${new Date(`${HISTORY_FEED_DAY}T00:00:10.000Z`)}, now(), 'MIGRATION',
        ${JSON.stringify({ schemaVersion: 1, recordKind, original: request })}::jsonb)`);
  }
}

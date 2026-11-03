import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  legacyRead,
  legacyProfileById,
} from './user-consolidation-legacy-read.fixture';
import {
  cleanupMigrationFixture,
  legacyDatabaseUrl,
  prepareLegacyFixture,
} from './user-consolidation-migration-harness';
import { UserProfileService } from '../src/users/user-profile.service';
import {
  consolidationId,
  withUserConsolidationFixture,
  PROFILE_CREATED_AT,
  PROFILE_UPDATED_AT,
  REQUEST_CREATED_AT,
  REQUEST_DECIDED_AT,
} from './user-consolidation-fixture';
import { BASELINE_CASES } from './user-consolidation-cases';
import {
  inspectUserConsolidationSubjects,
  readUserConsolidationSnapshot,
  UnmappedConsolidationEventError,
} from './user-consolidation-snapshot';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaClient({
  datasources: { db: { url: legacyDatabaseUrl } },
  log: [{ emit: 'event', level: 'query' }],
});
const queries: string[] = [];
prisma.$on('query', (event) => queries.push(event.query));
const read = legacyRead;
const history = legacyRead;
const profiles = new UserProfileService();

beforeAll(prepareLegacyFixture, 60_000);
afterAll(async () => {
  await prisma.$disconnect();
  await cleanupMigrationFixture();
});

it('inventories old persisted fields, independent flags and original source identities', async () => {
  await withUserConsolidationFixture(prisma, async (transaction) => {
    const { snapshot, subjects } =
      await inspectUserConsolidationSubjects(transaction);

    expect(
      Object.fromEntries(
        Object.entries(snapshot).map(([key, rows]) => [key, rows.length]),
      ),
    ).toEqual({
      users: 162,
      profiles: 157,
      requests: 10,
      consents: 2,
      logins: 1,
      audits: 4,
    });
    for (const row of BASELINE_CASES) {
      expect(
        snapshot.users.find((user) => user.id === consolidationId(row.label)),
      ).toMatchObject({ selectedMemberKind: row.selected });
      expect(
        snapshot.profiles.find(
          (profile) => profile.userId === consolidationId(row.label),
        )?.memberKind ?? null,
      ).toBe(row.profile);
    }
    expect(
      snapshot.profiles.every(
        (profile) =>
          profile.createdAt.getTime() === PROFILE_CREATED_AT.getTime() &&
          profile.updatedAt.getTime() === PROFILE_UPDATED_AT.getTime(),
      ),
    ).toBe(true);
    expect(subjects).toEqual([
      {
        eventId: consolidationId('audit:malformed'),
        userId: consolidationId('student-admin'),
      },
      {
        eventId: consolidationId('audit:mixed'),
        userId: consolidationId('student-admin-staff'),
      },
      {
        eventId: consolidationId('audit:request'),
        userId: consolidationId('staff-rejected'),
      },
    ]);
    const bytes = JSON.stringify(snapshot, (_, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'ed6284bc14f0d7bff6ecc2882abbd833e82fe8852326742483f6955c10467ee0',
    );
    console.info(
      'CONSOLIDATION_MANIFEST',
      JSON.stringify({
        counts: Object.fromEntries(
          Object.entries(snapshot).map(([key, rows]) => [key, rows.length]),
        ),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        subjects,
      }),
    );
  });
});

it('reads selected-without-profile separately from unselected and preserves student admin flags', async () => {
  await withUserConsolidationFixture(prisma, async (transaction) => {
    const rows = await Promise.all(
      ['unselected', 'selected-staff', 'student-admin-staff'].map((label) =>
        read.findAdminAccessUserById(transaction, consolidationId(label)),
      ),
    );

    expect(rows).toMatchObject([
      {
        memberKind: null,
        selectedMemberKind: null,
        name: null,
        pendingRequest: null,
      },
      {
        memberKind: null,
        selectedMemberKind: 'STAFF',
        name: null,
        pendingRequest: null,
      },
      {
        memberKind: 'STUDENT',
        selectedMemberKind: 'STUDENT',
        hasAdminAccess: true,
        hasStaffAccess: true,
      },
    ]);
    const incomplete = await legacyProfileById(
      transaction,
      consolidationId('incomplete-student'),
    );
    expect(
      profiles.isCompleteProfileFields(incomplete, incomplete.memberKind),
    ).toBe(false);
    const retained = await legacyProfileById(
      transaction,
      consolidationId('staff-retained-id'),
    );
    expect(retained).toMatchObject({
      memberKind: 'STAFF',
      studentId: '9700000012',
    });
    expect(
      profiles.isCompleteProfileFields(retained, retained.memberKind),
    ).toBe(true);
  });
});

it('keeps request decision tuples and createdAt/id page ordering without fabricating decisions', async () => {
  await withUserConsolidationFixture(prisma, async (transaction) => {
    const page = await history.listAdminAccessStaffAccessRequestHistory(
      transaction,
      consolidationId('staff-rejected'),
      { page: 1, limit: 1 },
    );
    const second = await history.listAdminAccessStaffAccessRequestHistory(
      transaction,
      consolidationId('staff-rejected'),
      { page: 2, limit: 1 },
    );

    expect(page).toEqual({
      items: [
        {
          id: consolidationId('request:staff-rejected:older'),
          status: 'REVOKED',
          rejectionReason: null,
          decidedAt: null,
          decidedBy: null,
          createdAt: REQUEST_CREATED_AT,
        },
      ],
      page: 1,
      limit: 1,
      total: 2,
    });
    expect(second.items).toEqual([
      {
        id: consolidationId('request:staff-rejected'),
        status: 'REJECTED',
        rejectionReason: 'Synthetic rejection',
        decidedAt: REQUEST_DECIDED_AT,
        decidedBy: consolidationId('student-admin'),
        createdAt: REQUEST_CREATED_AT,
      },
    ]);
  });
});

it('rejects an unmapped legacy subject during read-only inventory without changing source rows', async () => {
  await withUserConsolidationFixture(prisma, async (transaction) => {
    await transaction.$executeRaw`INSERT INTO "AuditLog"
      (id,"actorId",action,"targetType","targetId",metadata,"occurredAt")
      VALUES (${consolidationId('orphan')},${consolidationId('student-admin')},
        'USER_ROLE_CHANGED','ROLE_REQUEST',${consolidationId('missing-request')},
        '{}'::jsonb,${REQUEST_DECIDED_AT})`;
    const before = await readUserConsolidationSnapshot(transaction);
    const offset = queries.length;

    await expect(
      inspectUserConsolidationSubjects(transaction),
    ).rejects.toMatchObject({
      name: UnmappedConsolidationEventError.name,
      eventId: consolidationId('orphan'),
    });

    expect(
      queries.slice(offset).every((query) => query.startsWith('SELECT')),
    ).toBe(true);
    expect(await readUserConsolidationSnapshot(transaction)).toEqual(before);
  });
});

it.each([
  {
    name: 'duplicate studentId',
    mutation: Prisma.sql`"studentId" = '9700000005'`,
    code: '23505',
  },
  {
    name: 'malformed profile',
    mutation: Prisma.sql`"name" = ' '`,
    code: '23514',
  },
])(
  'old database rejects $name before migration',
  async ({ mutation, code }) => {
    await expect(
      withUserConsolidationFixture(prisma, async (transaction) => {
        await transaction.$executeRaw`
          UPDATE "UserProfile" SET ${mutation}
          WHERE "userId" = ${consolidationId('student-admin-staff')}
        `;
      }),
    ).rejects.toMatchObject({ code: 'P2010', meta: { code } });
  },
);

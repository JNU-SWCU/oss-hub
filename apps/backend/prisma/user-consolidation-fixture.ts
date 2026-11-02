import { Prisma, type PrismaClient } from '@prisma/client';
import { BASELINE_CASES, type BaselineCase } from './user-consolidation-cases';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import type {
  LegacyInsertRows,
  LegacyStore,
} from './user-consolidation-legacy-read.fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

export const CONSOLIDATION_PREFIX = 'test:user-consolidation:';
export const consolidationId = (label: string): string =>
  `${CONSOLIDATION_PREFIX}${label}`;
export const PROFILE_CREATED_AT = new Date('2026-08-01T01:02:03.000Z');
export const PROFILE_UPDATED_AT = new Date('2026-09-01T04:05:06.000Z');
export const REQUEST_CREATED_AT = new Date('2026-09-02T00:00:00.000Z');
export const REQUEST_DECIDED_AT = new Date('2026-09-03T00:00:00.000Z');

async function insertLegacyRows<Table extends keyof LegacyInsertRows>(
  transaction: LegacyStore,
  table: Table,
  rows: readonly LegacyInsertRows[Table][],
): Promise<void> {
  const target = Prisma.raw(`"${table}"`);
  const data = JSON.stringify(rows, (_, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  await transaction.$executeRaw(Prisma.sql`
    INSERT INTO ${target} SELECT * FROM jsonb_populate_recordset(NULL::${target}, ${data}::jsonb)
  `);
}

async function loadUserConsolidationFixture(
  transaction: LegacyStore,
): Promise<void> {
  const cases: readonly BaselineCase[] = [
    ...BASELINE_CASES,
    ...Array.from({ length: 162 - BASELINE_CASES.length }, (_, index) => ({
      label: `filler-${String(index).padStart(3, '0')}`,
      selected: 'STUDENT' as const,
      profile: 'STUDENT' as const,
    })),
  ];
  await insertLegacyRows(
    transaction,
    'User',
    cases.map((row, index) => ({
      id: consolidationId(row.label),
      githubId: 9_900_000_000n + BigInt(index),
      login: consolidationId(row.label),
      avatarUrl: null,
      selectedMemberKind: row.selected,
      hasStaffAccess: row.staff ?? false,
      hasAdminAccess: row.admin ?? false,
      phone: index === 5 ? '00000000000' : null,
      notificationEmail: index === 5 ? 'synthetic@example.invalid' : null,
      notifyEnabled: index === 5,
      accountStatus: index === 161 ? 'DEACTIVATED' : 'ACTIVE',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      sessionVersion: index,
    })),
  );
  await insertLegacyRows(
    transaction,
    'UserProfile',
    cases.flatMap((row, index) =>
      row.profile === null
        ? []
        : [
            {
              userId: consolidationId(row.label),
              name: `Synthetic ${row.label}`,
              studentId: row.incomplete
                ? null
                : row.profile === 'STUDENT' || row.retained
                  ? String(9700000000 + index)
                  : null,
              staffNumber: row.profile === 'STAFF' ? `S-${index}` : null,
              department: 'Synthetic department',
              affiliationName: 'Synthetic department',
              affiliationKind:
                row.profile === 'STUDENT' ? 'DEPARTMENT' : 'PROGRAM_OFFICE',
              memberKind: row.profile,
              createdAt: PROFILE_CREATED_AT,
              updatedAt: PROFILE_UPDATED_AT,
            },
          ],
    ),
  );
  await insertLegacyRows(
    transaction,
    'StaffAccessRequest',
    cases.flatMap((row) =>
      row.request === undefined
        ? []
        : [
            {
              id: consolidationId(`request:${row.label}`),
              userId: consolidationId(row.label),
              status: row.request,
              createdAt: REQUEST_CREATED_AT,
              updatedAt: REQUEST_DECIDED_AT,
              decidedAt: row.request === 'PENDING' ? null : REQUEST_DECIDED_AT,
              decidedById:
                row.request === 'PENDING'
                  ? null
                  : consolidationId('student-admin'),
              rejectionReason:
                row.request === 'REJECTED' ? 'Synthetic rejection' : null,
            },
          ],
    ),
  );
  await insertLegacyRows(transaction, 'StaffAccessRequest', [
    {
      id: consolidationId('request:staff-rejected:older'),
      userId: consolidationId('staff-rejected'),
      status: 'REVOKED',
      rejectionReason: null,
      decidedById: null,
      decidedAt: null,
      createdAt: REQUEST_CREATED_AT,
      updatedAt: REQUEST_DECIDED_AT,
    },
  ]);
  await insertLegacyRows(
    transaction,
    'Consent',
    ['2026-07-01', '2026-08-01'].map((policyVersion) => ({
      id: consolidationId(`consent:${policyVersion}`),
      userId: consolidationId('student-admin'),
      policyVersion,
      consentedAt: PROFILE_CREATED_AT,
    })),
  );
  await insertLegacyRows(transaction, 'LoginHistory', [
    {
      id: consolidationId('login'),
      userId: consolidationId('student-admin'),
      event: 'LOGIN',
      provider: 'github',
      success: true,
      loginAt: REQUEST_CREATED_AT,
    },
  ]);
  await insertLegacyRows(
    transaction,
    'AuditLog',
    [
      {
        id: consolidationId('audit:mixed'),
        action: 'USER_ROLE_CHANGED',
        targetType: 'USER',
        targetId: consolidationId('student-admin-staff'),
        metadata: {
          schemaVersion: 1,
          eventKind: 'DIRECT_ROLE_CHANGED',
          actor: {
            displayName: 'Synthetic actor',
            githubLogin: consolidationId('student-admin'),
          },
          before: {
            role: 'STUDENT',
            accountStatus: 'ACTIVE',
            requestStatus: null,
          },
          after: {
            role: 'ADMIN',
            accountStatus: 'ACTIVE',
            requestStatus: null,
          },
        },
      },
      {
        id: consolidationId('audit:request'),
        action: 'STAFF_ROLE_REQUEST_REJECTED',
        targetType: 'ROLE_REQUEST',
        targetId: consolidationId('request:staff-rejected'),
        metadata: { schemaVersion: 1, rejectionReason: 'Synthetic rejection' },
      },
      {
        id: consolidationId('audit:malformed'),
        action: 'USER_PROFILE_UPDATED',
        targetType: 'USER',
        targetId: consolidationId('student-admin'),
        metadata: ['unrecognized legacy metadata', 7],
      },
      {
        id: consolidationId('audit:other-domain'),
        action: 'PROGRAM_UPDATED',
        targetType: 'PROGRAM',
        targetId: consolidationId('historical-program'),
        metadata: { untouched: true },
      },
    ].map((row) => ({
      ...row,
      actorId: consolidationId('student-admin'),
      occurredAt: REQUEST_DECIDED_AT,
    })),
  );
}

class FixtureRollback extends Error {}

export async function withUserConsolidationFixture(
  prisma: Pick<PrismaClient, '$transaction'>,
  operation: (transaction: LegacyStore) => Promise<void>,
): Promise<void> {
  try {
    await prisma.$transaction(
      async (transaction) => {
        await loadUserConsolidationFixture(transaction);
        await operation(transaction);
        throw new FixtureRollback();
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (!(error instanceof FixtureRollback)) throw error;
  }
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  'migrations/20260810120000_add_program_authoring_foundation/migration.sql',
);
const schemaPath = resolve(__dirname, 'schema.prisma');

describe('Program authoring schema contract', () => {
  const schema = readFileSync(schemaPath, 'utf8');
  const migration = readFileSync(migrationPath, 'utf8');

  it('declares required Program and Milestone schedule/team fields', () => {
    expect(schema).toMatch(/startAt\s+DateTime/);
    expect(schema).toMatch(/endAt\s+DateTime\s/);
    expect(schema).toMatch(/teamMinSize\s+Int\s/);
    expect(schema).toMatch(/teamMaxSize\s+Int\s/);
    expect(schema).toMatch(/model Milestone[\s\S]*startAt\s+DateTime/);
  });

  it('declares actor-owned upload lifecycle and idempotent create request foundations', () => {
    expect(schema).toContain('model ProgramAuthoringUpload');
    expect(schema).toContain('enum ProgramAuthoringUploadLifecycle');
    expect(schema).toContain('sha256');
    expect(schema).toContain('deleteClaimExpiresAt');
    expect(schema).toContain('model ProgramCreateRequest');
    expect(schema).toContain('@@unique([actorId, idempotencyKey])');
    expect(schema).toContain('payloadHash');
    expect(schema).toContain('createRequestId');
    expect(schema).toContain('createRequestActorId');
    expect(schema).toContain('uploads ProgramAuthoringUpload[]');
  });

  it('preflights before DDL, backfills, then applies required checks', () => {
    const preflight = migration.indexOf('DO $$');
    const firstAlter = migration.indexOf('ALTER TABLE');
    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(firstAlter).toBeGreaterThan(preflight);
    expect(migration).toContain('SET "startAt" = "applicationEndAt"');
    expect(migration).toContain('SET "teamMinSize" = 1');
    expect(migration).toContain('SET "teamMaxSize" = 1');
    expect(migration).toContain('Program_applicationToOperatingWindow_check');
    expect(migration).toContain('Program_operatingWindow_check');
    expect(migration).toContain('Program_teamSize_check');
    expect(migration).toContain('Milestone_operatingWindow_check');
  });

  it('locks writers before preflight and installs bounded legacy-write compatibility', () => {
    const lockTimeout = migration.indexOf("SET LOCAL lock_timeout = '1s'");
    const programLock = migration.indexOf(
      'LOCK TABLE "Program" IN SHARE ROW EXCLUSIVE MODE',
    );
    const milestoneLock = migration.indexOf(
      'LOCK TABLE "Milestone" IN SHARE ROW EXCLUSIVE MODE',
    );
    const preflight = migration.indexOf('DO $$');
    expect(lockTimeout).toBeGreaterThanOrEqual(0);
    expect(programLock).toBeGreaterThan(lockTimeout);
    expect(milestoneLock).toBeGreaterThan(programLock);
    expect(preflight).toBeGreaterThan(milestoneLock);
    expect(migration).toContain('Program_legacy_write_compatibility');
    expect(migration).toContain('Milestone_legacy_write_compatibility');
  });

  it('enforces canonical hashes, bounded keys, lifecycle, claims, and attachment ownership', () => {
    expect(migration).toContain("~ '^[0-9a-f]{64}$'");
    expect(migration).toContain('ProgramCreateRequest_idempotencyKey_check');
    expect(migration).toContain('ProgramAuthoringUpload_lifecycle_check');
    expect(migration).toContain('ProgramAuthoringUpload_delete_claim_check');
    expect(migration).toContain('ProgramAuthoringUpload_lastDeleteError_check');
    expect(migration).toContain(
      'ProgramAuthoringUpload_createRequest_actor_check',
    );
    expect(migration).toContain(
      'ProgramAuthoringUpload_createRequestActorId_createRequestI_fkey',
    );
    expect(migration).toContain(
      'ProgramAuthoringUpload_lifecycle_nextDeleteAttemptAt_delete_idx',
    );
  });
});

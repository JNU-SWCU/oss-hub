import {
  artifact,
  cleanupMigrationFixture,
  forward,
  inMigrationDatabase,
  prepareMigrationFixture,
  sourceSnapshot,
  sql,
} from './user-consolidation-migration-harness';
jest.setTimeout(120_000);
beforeAll(prepareMigrationFixture);
afterAll(cleanupMigrationFixture);

it('allows deleting a new user when archived foreign key cascades match no source rows', async () => {
  await inMigrationDatabase(async (url) => {
    await forward(url);
    await sql(
      url,
      `INSERT INTO "User" (id,"githubId",login,"updatedAt")
      VALUES ('post-migration-user',99999999999,'post-migration-user',CURRENT_TIMESTAMP)`,
    );
    expect(
      await sql(
        url,
        `WITH removed AS (
      DELETE FROM "User" WHERE id='post-migration-user' RETURNING id
    ) SELECT id FROM removed`,
      ),
    ).toBe('post-migration-user');
    await sql(url, await artifact('reconcile'));
  });
});

it('rejects a cascade that would delete an existing archived profile without changing its fields', async () => {
  await inMigrationDatabase(async (url) => {
    await forward(url);
    const before = await sql(
      url,
      `SELECT to_jsonb(p) FROM user_consolidation_backup."UserProfile" p WHERE "userId"='filler-1'`,
    );
    await expect(
      sql(url, `DELETE FROM "User" WHERE id='filler-1'`),
    ).rejects.toThrow(/append-only/);
    expect(
      await sql(
        url,
        `SELECT to_jsonb(p) FROM user_consolidation_backup."UserProfile" p WHERE "userId"='filler-1'`,
      ),
    ).toBe(before);
    await sql(url, await artifact('reconcile'));
  });
});

it('enforces transferred profile, approval, administrator and provenance constraints', async () => {
  await inMigrationDatabase(async (url) => {
    await forward(url);
    for (const invalidWrite of [
      `UPDATE "User" SET name=' invalid ' WHERE id='student-admin'`,
      `UPDATE "User" SET "studentId"='bad' WHERE id='staff-retained-id'`,
      `UPDATE "User" SET "studentId"=(SELECT "studentId" FROM "User" WHERE id='student-admin') WHERE id='student-admin-staff'`,
      `UPDATE "User" SET "approvalStatus"='NOT_REQUIRED' WHERE id='staff-approved'`,
      `UPDATE "User" SET "approvalStatus"='PENDING' WHERE id='student-admin'`,
      `UPDATE "User" SET "approvalRequestId"=NULL WHERE id='staff-pending'`,
      `INSERT INTO "Admin" ("userId",origin) VALUES ('unselected','ADMIN')`,
      `INSERT INTO "UserHistory" (id,"userId",event,source,"sourceTable","sourceId","sourcePart",data)
        SELECT 'duplicate-import',"userId",event,source,"sourceTable","sourceId","sourcePart",data
        FROM "UserHistory" WHERE "sourceId"='audit:request'`,
    ]) {
      await expect(sql(url, invalidWrite)).rejects.toThrow(
        /violates|duplicate/,
      );
    }
    for (const [table, key] of [
      ['source_rows', 'id'],
      ['forward_rows', 'id'],
      ['"UserProfile"', '"userId"'],
      ['"StaffAccessRequest"', 'id'],
    ] as const) {
      await expect(
        sql(url, `DELETE FROM user_consolidation_backup.${table}`),
      ).rejects.toThrow(/append-only/);
      await expect(
        sql(
          url,
          `UPDATE user_consolidation_backup.${table} SET ${key}=${key} || ':forbidden'`,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        sql(url, `TRUNCATE user_consolidation_backup.${table}`),
      ).rejects.toThrow(/append-only/);
    }
    expect(
      await sql(
        url,
        `SELECT count(*) FROM pg_namespace n,
      LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) p
      WHERE n.nspname='user_consolidation_backup' AND p.grantee=0`,
      ),
    ).toBe('0');
    await sql(url, await artifact('reconcile'));
  });
});

it.each([
  [
    'unexpected successful terminal migration',
    `INSERT INTO _prisma_migrations (id,checksum,migration_name,finished_at,applied_steps_count)
      VALUES ('unknown-later',repeat('0',64),'20261103120000_unknown_later_change',CURRENT_TIMESTAMP,1)`,
    /unexpected migration ledger/,
  ],
  [
    'request orphan',
    `INSERT INTO "AuditLog" (id,"actorId",action,"targetType","targetId",metadata)
    VALUES ('orphan','student-admin','STAFF_ROLE_REQUEST_REJECTED','ROLE_REQUEST','absent','{}')`,
    /unresolved audit subjects/,
  ],
  [
    'duplicate',
    `DROP INDEX "UserProfile_studentId_key"; UPDATE "UserProfile" SET "studentId"='9700000001' WHERE "userId" IN ('student-admin','student-admin-staff')`,
    /duplicate studentId/,
  ],
  [
    'malformed',
    `ALTER TABLE "UserProfile" DROP CONSTRAINT "UserProfile_name_check"; UPDATE "UserProfile" SET name=' invalid ' WHERE "userId"='student-admin'`,
    /invalid profile/,
  ],
])(
  'preflight rejects %s with zero data or schema writes',
  async (_label, corruption, error) => {
    await inMigrationDatabase(async (url) => {
      await sql(url, corruption);
      const before = await sourceSnapshot(url);
      await expect(sql(url, await artifact('preflight'))).rejects.toThrow(
        error,
      );
      expect(await sourceSnapshot(url)).toBe(before);
      expect(
        await sql(
          url,
          `SELECT to_regnamespace('user_consolidation_backup') IS NULL`,
        ),
      ).toBe('t');
      await expect(forward(url)).rejects.toThrow();
      expect(await sourceSnapshot(url)).toBe(before);
      expect(
        await sql(
          url,
          `SELECT to_regnamespace('user_consolidation_backup') IS NULL`,
        ),
      ).toBe('t');
    });
  },
);

it('retains an orphan USER audit byte-for-byte in the fallback feed without fabricating a user', async () => {
  await inMigrationDatabase(async (url) => {
    await sql(
      url,
      `INSERT INTO "AuditLog" (id,"actorId",action,"targetType","targetId",metadata)
      VALUES ('orphan','student-admin','USER_PROFILE_UPDATED','USER','absent',
      '{"schemaVersion":1,"actor":{},"changes":[],"target":{}}')`,
    );
    const original = await sql(
      url,
      `SELECT to_jsonb(a) FROM "AuditLog" a WHERE id='orphan'`,
    );
    await sql(url, await artifact('preflight'));
    await forward(url);
    await sql(url, await artifact('reconcile'));
    expect(
      await sql(url, `SELECT to_jsonb(a) FROM "AuditLog" a WHERE id='orphan'`),
    ).toBe(original);
    expect(
      await sql(url, `SELECT count(*) FROM "User" WHERE id='absent'`),
    ).toBe('0');
    expect(
      await sql(
        url,
        `SELECT count(*) FROM (
      SELECT id FROM "AuditLog" a WHERE NOT EXISTS (SELECT 1 FROM "UserHistory" h WHERE h."sourceTable"='AuditLog' AND h."sourceId"=a.id)
        AND NOT EXISTS (SELECT 1 FROM "AdminHistory" h WHERE h."sourceTable"='AuditLog' AND h."sourceId"=a.id)
      UNION SELECT data->>'canonicalEventId' FROM "UserHistory" WHERE data->>'recordKind'='AUDIT_EVENT'
      UNION SELECT data->>'canonicalEventId' FROM "AdminHistory" WHERE data->>'recordKind'='AUDIT_EVENT'
    ) feed WHERE id='orphan'`,
      ),
    ).toBe('1');
  });
});

it('preserves original audits and canonicalizes compound imports with immutable histories', async () => {
  await inMigrationDatabase(async (url) => {
    await forward(url);
    expect(
      await sql(
        url,
        `SELECT count(DISTINCT data->>'canonicalEventId') FROM (
      SELECT data FROM "UserHistory" UNION ALL SELECT data FROM "AdminHistory"
    ) h WHERE data->>'recordKind'='AUDIT_EVENT'`,
      ),
    ).toBe('4');
    expect(
      await sql(
        url,
        `SELECT "sourcePart" FROM "UserHistory" WHERE "sourceId"='audit:mixed'`,
      ),
    ).toBe('user');
    expect(
      await sql(
        url,
        `SELECT "sourcePart" FROM "AdminHistory" WHERE "sourceId"='audit:mixed'`,
      ),
    ).toBe('admin');
    expect(
      await sql(
        url,
        `SELECT "userId" FROM "UserHistory" WHERE "sourceId"='audit:request'`,
      ),
    ).toBe('staff-rejected');
    for (const table of ['UserHistory', 'AdminHistory', 'AuditLog']) {
      await expect(sql(url, `UPDATE "${table}" SET id=id`)).rejects.toThrow(
        /append-only/,
      );
      await expect(sql(url, `DELETE FROM "${table}"`)).rejects.toThrow(
        /append-only/,
      );
      await expect(sql(url, `TRUNCATE "${table}"`)).rejects.toThrow(
        /append-only/,
      );
    }
    await sql(url, await artifact('reconcile'));
  });
});

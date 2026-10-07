import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const rehearsal = readFileSync(
  new URL('./rehearse-member-authority-contract.sh', import.meta.url),
  'utf8',
);

test('contract rehearsal initializes disposable paths before the EXIT trap', () => {
  const trap = rehearsal.indexOf('trap cleanup EXIT');
  for (const name of ["staged=''", "backup=''", "port=''"]) {
    const init = rehearsal.indexOf(name);
    assert.ok(init >= 0, `${name} must start empty so set -u cleanup is safe`);
    assert.ok(
      trap > init,
      `${name} must be initialized before trap cleanup EXIT`,
    );
  }
});

test('contract rehearsal cleanup removes the container with its volumes and both tmp trees', () => {
  assert.match(rehearsal, /docker rm -f -v "\$container"/);
  assert.match(
    rehearsal,
    /mktemp -d "\$\{TMPDIR:-\/tmp\}\/contract-staged\.XXXXXX"/,
  );
  assert.match(
    rehearsal,
    /mktemp -d "\$\{TMPDIR:-\/tmp\}\/contract-backup\.XXXXXX"/,
  );
  assert.match(
    rehearsal,
    /if \[\[ -n \$\{staged:-\} \]\]; then\s+rm -rf -- "\$staged"/s,
  );
  assert.match(
    rehearsal,
    /if \[\[ -n \$\{backup:-\} \]\]; then\s+rm -rf -- "\$backup"/s,
  );
});

test('contract rehearsal deploys the staged pre-contract schema without a process-substitution fallback', () => {
  assert.doesNotMatch(rehearsal, /PRISMA_MIGRATIONS_PATH/);
  assert.doesNotMatch(rehearsal, /<\(/);
  assert.match(
    rehearsal,
    /pnpm exec prisma migrate deploy --schema "\$staged\/schema\.prisma"/,
  );
});

test('contract rehearsal seeds the 62-user fixture before any destructive DDL', () => {
  assert.match(rehearsal, /member-authority-contract-62-users\.json/);
  const seed = rehearsal.indexOf('seed_fixture');
  const apply = rehearsal.indexOf('apply_contract()');
  assert.ok(seed >= 0 && apply >= 0);
  assert.match(rehearsal, /\[\[ "\$users_before" == '62' \]\]/);
});

test('contract lane proves row, id and request-status preservation', () => {
  assert.match(rehearsal, /ids_before=\$\(user_digest\)/);
  assert.match(rehearsal, /requests_before=\$\(request_digest 'RoleRequest'\)/);
  assert.match(
    rehearsal,
    /requests_after=\$\(request_digest 'StaffAccessRequest'\)/,
  );
  assert.match(rehearsal, /\[\[ "\$ids_before" == "\$ids_after" \]\]/);
  assert.match(
    rehearsal,
    /\[\[ "\$requests_before" == "\$requests_after" \]\]/,
  );
});

test('contract lane proves backup restore and previous-image rejection', () => {
  assert.match(
    rehearsal,
    /pg_dump -U migration -d contract_rehearsal --format=custom/,
  );
  assert.match(
    rehearsal,
    /pg_restore -U migration -d contract_rehearsal --no-owner/,
  );

  assert.match(
    rehearsal,
    /previous image query shape still resolves — rollback boundary is broken/,
  );
});

test('contract lane proves identity is never inferred from authority', () => {
  assert.match(rehearsal, /student_admins=/);
  assert.match(
    rehearsal,
    /no student-identity admin survived — identity was inferred from authority/,
  );
});

test('contract-negative exercises all four abort lanes before destructive DDL', () => {
  for (const reason of [
    "assert_preflight_aborted 'an unresolved member kind on an assigned admin'",
    "assert_preflight_aborted 'a duplicated student id'",
    "assert_preflight_aborted 'a v0.6.95-era legacy role that contradicts canonical facts'",
    "assert_preflight_aborted 'a drifted (unfinished) migration ledger row'",
  ]) {
    assert.ok(
      rehearsal.includes(reason),
      `contract-negative must exercise: ${reason}`,
    );
  }
});

test('every negative lane re-proves the rollback surface survived', () => {
  assert.match(
    rehearsal,
    /User\.role was dropped despite the failed preflight/,
  );
  assert.match(
    rehearsal,
    /RoleRequest was renamed despite the failed preflight/,
  );
  assert.match(rehearsal, /Role enum was dropped despite the failed preflight/);
});

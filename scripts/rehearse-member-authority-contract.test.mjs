import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const rehearsal = readFileSync(
  new URL('./rehearse-member-authority-contract.sh', import.meta.url),
  'utf8',
);

test('contract rehearsal initializes staged before the EXIT trap', () => {
  const stagedInit = rehearsal.indexOf("staged=''");
  const trap = rehearsal.indexOf('trap cleanup EXIT');
  assert.ok(stagedInit >= 0, 'staged must start empty so set -u cleanup is safe');
  assert.ok(trap > stagedInit, 'staged must be initialized before trap cleanup EXIT');
});

test('contract rehearsal cleanup removes the staged migrations directory', () => {
  assert.match(rehearsal, /mktemp -d "\$\{TMPDIR:-\/tmp\}\/contract-staged\.XXXXXX"/);
  assert.match(
    rehearsal,
    /if \[\[ -n \$\{staged:-\} \]\]; then\s+rm -rf -- "\$staged"/s,
  );
});

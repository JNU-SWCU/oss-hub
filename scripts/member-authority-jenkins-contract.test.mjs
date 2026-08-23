import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const jenkinsfilePath = fileURLToPath(
  new URL('../Jenkinsfile', import.meta.url),
);
const source = readFileSync(jenkinsfilePath, 'utf8');

test('Jenkins no longer owns the completed member authority backfill', () => {
  assert.doesNotMatch(source, /stage\('회원 권한 backfill'\)/);
  assert.doesNotMatch(source, /verify-member-authority-backfill\.mjs/);
});

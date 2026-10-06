import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const checkerPath = fileURLToPath(
  new URL('./check-jenkinsfile.sh', import.meta.url),
);
const jenkinsfilePath = fileURLToPath(
  new URL('../Jenkinsfile', import.meta.url),
);
const fixtureRoot = mkdtempSync(join(tmpdir(), 'jenkins-prisma-contract-'));
const source = readFileSync(jenkinsfilePath, 'utf8');

after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function checkFixture(name, contents) {
  const fixturePath = join(fixtureRoot, name);
  writeFileSync(fixturePath, contents);
  return spawnSync(checkerPath, [fixturePath], { encoding: 'utf8' });
}

test('Jenkins contract accepts serialized migrate deploy', () => {
  const result = spawnSync(checkerPath, [jenkinsfilePath], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
});

test('Jenkins contract rejects missing pipeline serialization', () => {
  const fixture = source.replace('disableConcurrentBuilds()', 'removed()');

  const result = checkFixture('missing-concurrency', fixture);

  assert.equal(result.status, 1);
});

test('Jenkins contract rejects missing production migrate deploy', () => {
  const fixture = source.replace(
    'npx prisma migrate deploy',
    'npx prisma migrate status',
  );

  const result = checkFixture('missing-migrate-deploy', fixture);

  assert.equal(result.status, 1);
});

test('Jenkins contract rejects missing greenfield host-clean guard', () => {
  const fixture = source.replace(
    'bash scripts/jenkins/assert-greenfield-host-clean.sh',
    'true',
  );
  assert.notEqual(fixture, source);

  const result = checkFixture('missing-greenfield-host-clean', fixture);

  assert.equal(result.status, 1);
});

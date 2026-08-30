import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'scripts/legacy-submission-production-report.mjs');
const INVENTORY = join(
  ROOT,
  'scripts/legacy-submission-runtime-inventory.json',
);
const DIGEST = 'a'.repeat(64);

function fixture() {
  return {
    schema: 'oss-hub.legacy-submission-report-input.v1',
    source: {
      submissions: 3,
      revisions: 5,
      reviews: 2,
      filesByLifecycle: {
        PENDING: 1,
        ATTACHED: 2,
        DELETE_PENDING: 3,
        DELETED: 4,
      },
    },
    target: {
      internalSlots: 3,
      headers: 3,
      histories: 5,
      reviewHistories: 2,
      reviewEvents: 2,
      linkedFilesByLifecycle: {
        PENDING: 1,
        ATTACHED: 2,
        DELETE_PENDING: 3,
        DELETED: 4,
      },
    },
    mismatches: {
      submissions: 0,
      revisions: 0,
      reviews: 0,
      reviewEvents: 0,
      files: 0,
      currentHeaders: 0,
    },
    orphans: 0,
    unmappedNonSeed: 0,
    allSeedCandidates: 0,
    runtimeLegacyAccess: 0,
    legacyWritesAfterCutover: 0,
    provenanceDigest: DIGEST,
    baselineProvenanceDigest: DIGEST,
    migrationLedger: { bridgeApplied: 1, unfinished: 0 },
    restore: { database: 'passed', objects: 'passed' },
  };
}

function run(mode, input = fixture(), extraArgs = []) {
  return spawnSync(
    process.execPath,
    [CLI, '--mode', mode, '--json', ...extraArgs],
    {
      cwd: ROOT,
      encoding: 'utf8',
      input: typeof input === 'string' ? input : JSON.stringify(input),
    },
  );
}

function report(result, expectedStatus) {
  assert.equal(result.status, expectedStatus);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, expectedStatus === 0 ? 'PASS' : 'FAIL');
  assert.deepEqual(Object.keys(output), [
    'schema',
    'mode',
    'status',
    'counts',
    'gates',
  ]);
  return output;
}

function change(path, value) {
  const input = fixture();
  const segments = path.split('.');
  let target = input;
  for (const segment of segments.slice(0, -1)) target = target[segment];
  target[segments.at(-1)] = value;
  return input;
}

test('all modes emit deterministic PASS reports for a matching aggregate', () => {
  for (const mode of ['baseline', 'post-bridge', 'ready-for-contract']) {
    const first = run(mode);
    const output = report(first, 0);
    assert.equal(output.mode, mode);
    assert.equal(output.schema, 'oss-hub.legacy-submission-report.v1');
    assert.equal(run(mode).stdout, first.stdout);
  }
});

test('baseline fails only its all-seed gate without echoing digests', () => {
  const output = report(run('baseline', change('allSeedCandidates', 1)), 1);
  assert.deepEqual(output.gates, [
    {
      id: 'all-seed-candidates-zero',
      status: 'FAIL',
      actual: 1,
      expected: 0,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(output), new RegExp(DIGEST));
});

test('post-bridge emits FAIL for every count equality gate', () => {
  const failures = [
    'target.headers',
    'target.histories',
    'target.reviewHistories',
    'target.reviewEvents',
    'target.linkedFilesByLifecycle.PENDING',
    'target.linkedFilesByLifecycle.ATTACHED',
    'target.linkedFilesByLifecycle.DELETE_PENDING',
    'target.linkedFilesByLifecycle.DELETED',
  ];
  for (const path of failures) {
    const output = report(run('post-bridge', change(path, 99)), 1);
    assert.ok(
      output.gates.some((gate) => gate.status === 'FAIL'),
      path,
    );
  }
});

test('post-bridge emits FAIL for every mismatch and zero-count gate', () => {
  const failures = [
    'mismatches.submissions',
    'mismatches.revisions',
    'mismatches.reviews',
    'mismatches.reviewEvents',
    'mismatches.files',
    'mismatches.currentHeaders',
    'orphans',
    'unmappedNonSeed',
    'allSeedCandidates',
  ];
  for (const path of failures) {
    const output = report(run('post-bridge', change(path, 1)), 1);
    assert.ok(
      output.gates.some((gate) => gate.status === 'FAIL'),
      path,
    );
  }
});

test('post-bridge fails closed for absent, changed, and incomplete provenance', () => {
  const failures = [
    change('provenanceDigest', null),
    change('baselineProvenanceDigest', null),
    change('baselineProvenanceDigest', 'b'.repeat(64)),
    change('migrationLedger.bridgeApplied', 0),
    change('migrationLedger.bridgeApplied', 2),
    change('migrationLedger.unfinished', 1),
  ];
  for (const input of failures) report(run('post-bridge', input), 1);
});

test('post-bridge has both passing and failing outcomes', () => {
  report(run('post-bridge'), 0);
  report(run('post-bridge', change('mismatches.files', 1)), 1);
});

test('ready-for-contract fails runtime, post-cutover write, and restore gates', () => {
  const failures = [
    change('runtimeLegacyAccess', 1),
    change('legacyWritesAfterCutover', 1),
    change('restore.database', 'not_run'),
    change('restore.database', 'failed'),
    change('restore.objects', 'not_run'),
    change('restore.objects', 'failed'),
  ];
  for (const input of failures) report(run('ready-for-contract', input), 1);
});

test('ready-for-contract includes all post-bridge gates', () => {
  report(run('ready-for-contract'), 0);
  report(
    run(
      'ready-for-contract',
      change('target.linkedFilesByLifecycle.DELETED', 0),
    ),
    1,
  );
});

test('malformed JSON and invalid aggregate values exit 2', () => {
  const invalidInputs = [
    '{',
    JSON.stringify({ ...fixture(), unexpected: 0 }),
    JSON.stringify(change('source.submissions', -1)),
    JSON.stringify(change('source.revisions', 1.5)),
    JSON.stringify(change('source.reviews', Number.MAX_SAFE_INTEGER + 1)),
    JSON.stringify(change('provenanceDigest', 'A'.repeat(64))),
    JSON.stringify(change('baselineProvenanceDigest', 'short')),
  ];
  for (const input of invalidInputs) {
    const result = run('baseline', input);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr,
      'legacy-submission-production-report: invalid input\n',
    );
  }
});

test('unexpected nested keys are rejected without leaking sentinel PII', () => {
  const sentinelKey = 'privateStudentName';
  const sentinelValue = 'SENTINEL-PII-DO-NOT-PRINT';
  const input = fixture();
  input.source[sentinelKey] = sentinelValue;
  const result = run('baseline', input);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, new RegExp(sentinelKey));
  assert.doesNotMatch(result.stderr, new RegExp(sentinelValue));
});

test('unknown or missing CLI arguments exit 2', () => {
  const argumentSets = [
    [],
    ['--mode', 'baseline'],
    ['--mode', 'unknown', '--json'],
    ['--mode', 'baseline', '--json', '--yaml'],
    ['--mode', 'baseline', '--json', '--mode', 'baseline'],
    ['--mode', 'baseline', '--json', '--input'],
  ];
  for (const args of argumentSets) {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      input: JSON.stringify(fixture()),
    });
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.stdout, '');
  }
});

test('--input reads a UTF-8 JSON file instead of stdin', () => {
  const directory = mkdtempSync(join(tmpdir(), 'legacy-submission-report-'));
  const inputPath = join(directory, 'aggregate.json');
  try {
    writeFileSync(inputPath, JSON.stringify(fixture()), 'utf8');
    report(run('baseline', '', ['--input', inputPath]), 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runtime inventory is explicit, repo-relative, and points to known files', () => {
  const inventory = JSON.parse(readFileSync(INVENTORY, 'utf8'));
  assert.equal(
    inventory.schema,
    'oss-hub.legacy-submission-runtime-inventory.v1',
  );
  assert.deepEqual(inventory.legacyModels, [
    'Submission',
    'SubmissionRevision',
    'Review',
  ]);
  assert.deepEqual(inventory.legacyWriteOperations, [
    'create',
    'createMany',
    'update',
    'updateMany',
    'upsert',
    'delete',
    'deleteMany',
  ]);
  for (const path of [
    ...inventory.runtimePaths,
    ...inventory.allowedNonRuntimePrefixes,
  ]) {
    assert.equal(path.startsWith('/') || /^[A-Za-z]:/.test(path), false, path);
    assert.doesNotMatch(path, /[*?[\]{}]/, path);
    assert.equal(path.includes('..'), false, path);
  }
  assert.equal(
    new Set(inventory.runtimePaths).size,
    inventory.runtimePaths.length,
  );
  for (const path of inventory.runtimePaths) {
    assert.equal(existsSync(join(ROOT, path)), true, path);
  }
  assert.ok(
    inventory.allowedNonRuntimePrefixes.includes(
      'apps/backend/prisma/migrations/',
    ),
  );
  assert.ok(
    inventory.runtimePaths.some((path) => path.includes('/submissions/')),
  );
  assert.ok(
    inventory.runtimePaths.some((path) =>
      path.includes('/submission-reviews/'),
    ),
  );
  assert.ok(
    inventory.runtimePaths.some((path) => path.includes('program-lifecycle')),
  );
  assert.ok(
    inventory.runtimePaths.some((path) =>
      path.includes('milestone-completion'),
    ),
  );
  assert.ok(
    inventory.runtimePaths.some((path) => path.includes('program-overview')),
  );
});

import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rehearsalPath = fileURLToPath(
  new URL('./rehearse-legacy-submission-migrations.sh', import.meta.url),
);
const MODES = [
  'fresh',
  'upgrade',
  'bridge-success',
  'bridge-replay-sql',
  'collision-fails',
  'prelive-cleanup-rollback',
  'forward-repair',
  'catch-up',
  'contract-negative',
  'contract-success',
  'restore-db-and-objects',
];
const CURRENT_ONLY_MODES = new Set(['fresh', 'upgrade']);
const EXPAND_AND_BRIDGE_MODES = new Set([
  'bridge-success',
  'bridge-replay-sql',
  'collision-fails',
  'prelive-cleanup-rollback',
  'forward-repair',
  'catch-up',
]);
const MIGRATION_ENV_NAMES = [
  'LEGACY_SUBMISSION_EXPAND_MIGRATION',
  'LEGACY_SUBMISSION_BRIDGE_MIGRATION',
  'LEGACY_SUBMISSION_CONTRACT_MIGRATION',
];
const OUTPUT_LINE =
  /^(?:METRIC [a-z][a-z0-9_]*=[0-9]+|RESULT (?:PASS|FAIL|SETUP_ERROR))$/;

function runRehearsal(args, environment = {}) {
  return spawnSync('bash', [rehearsalPath, ...args], {
    encoding: 'utf8',
    env: {
      HOME: environment.TMPDIR ?? tmpdir(),
      LC_ALL: 'C',
      PATH: process.env.PATH,
      ...environment,
    },
  });
}

function outputLines(result) {
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.endsWith('\n'));
  const lines = result.stdout.trimEnd().split('\n');
  assert.ok(
    lines.every((line) => OUTPUT_LINE.test(line)),
    result.stdout,
  );
  assert.equal(lines.filter((line) => line.startsWith('RESULT ')).length, 1);
  assert.ok(lines.at(-1).startsWith('RESULT '));
  return lines;
}

function assertResult(result, status, resultLabel, metric) {
  assert.equal(result.status, status, result.stdout);
  const lines = outputLines(result);
  assert.deepEqual(lines, [`METRIC ${metric}=1`, `RESULT ${resultLabel}`]);
}

function createMigrationFixtures(root) {
  const environment = {};
  for (const [index, name] of MIGRATION_ENV_NAMES.entries()) {
    const directory = join(root, `migration-${index}`);
    mkdirSync(directory);
    writeFileSync(join(directory, 'migration.sql'), 'SELECT 1;\n');
    environment[name] = directory;
  }
  return environment;
}

function requiredMigrationEnvironment(mode, allMigrations) {
  if (CURRENT_ONLY_MODES.has(mode)) {
    return {};
  }
  if (EXPAND_AND_BRIDGE_MODES.has(mode)) {
    return {
      LEGACY_SUBMISSION_EXPAND_MIGRATION:
        allMigrations.LEGACY_SUBMISSION_EXPAND_MIGRATION,
      LEGACY_SUBMISSION_BRIDGE_MIGRATION:
        allMigrations.LEGACY_SUBMISSION_BRIDGE_MIGRATION,
    };
  }
  return { ...allMigrations };
}

test('shell syntax is valid', () => {
  const result = spawnSync('bash', ['-n', rehearsalPath], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('missing, unknown, malformed, and extra mode arguments fail closed', () => {
  const invocations = [
    [],
    ['--mode'],
    ['--mode', 'unknown'],
    ['fresh'],
    ['--other', 'fresh'],
    ['--mode', 'fresh', 'extra'],
  ];

  for (const args of invocations) {
    const result = runRehearsal(args, {
      LEGACY_SUBMISSION_REHEARSAL_DRY_RUN: '1',
    });
    assertResult(result, 2, 'SETUP_ERROR', 'argument_invalid');
  }
});

test('dry-run validates every mode and its exact migration prerequisites', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-rehearsal-test-'));
  try {
    const allMigrations = createMigrationFixtures(fixtureRoot);

    for (const mode of MODES) {
      const baseEnvironment = {
        LEGACY_SUBMISSION_REHEARSAL_DRY_RUN: '1',
        TMPDIR: fixtureRoot,
        SYNTHETIC_SENTINEL_SECRET: 'synthetic-secret-must-not-leak',
      };
      const absentResult = runRehearsal(['--mode', mode], baseEnvironment);
      if (CURRENT_ONLY_MODES.has(mode)) {
        assertResult(absentResult, 0, 'PASS', 'mode_validated');
      } else {
        assertResult(absentResult, 2, 'SETUP_ERROR', 'setup_missing_migration');
      }
      assert.doesNotMatch(
        absentResult.stdout,
        /synthetic-secret-must-not-leak/,
      );
      assert.doesNotMatch(absentResult.stdout, /legacy-rehearsal-test-/);

      const required = requiredMigrationEnvironment(mode, allMigrations);
      const presentResult = runRehearsal(['--mode', mode], {
        ...baseEnvironment,
        ...required,
      });
      assertResult(presentResult, 0, 'PASS', 'mode_validated');
      assert.doesNotMatch(
        presentResult.stdout,
        /synthetic-secret-must-not-leak/,
      );
      assert.doesNotMatch(presentResult.stdout, /legacy-rehearsal-test-/);

      for (const requiredName of Object.keys(required)) {
        const incomplete = { ...baseEnvironment, ...required };
        delete incomplete[requiredName];
        assertResult(
          runRehearsal(['--mode', mode], incomplete),
          2,
          'SETUP_ERROR',
          'setup_missing_migration',
        );
      }
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('dry-run rejects migration paths without a migration file', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-rehearsal-test-'));
  try {
    const missingFileDirectory = join(fixtureRoot, 'empty-migration');
    mkdirSync(missingFileDirectory);
    const result = runRehearsal(['--mode', 'bridge-success'], {
      LEGACY_SUBMISSION_REHEARSAL_DRY_RUN: '1',
      LEGACY_SUBMISSION_EXPAND_MIGRATION: missingFileDirectory,
      LEGACY_SUBMISSION_BRIDGE_MIGRATION: missingFileDirectory,
      TMPDIR: fixtureRoot,
    });

    assertResult(result, 2, 'SETUP_ERROR', 'setup_missing_migration');
    assert.doesNotMatch(result.stdout, /legacy-rehearsal-test-/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('future real modes fail closed when migration paths exist but fixture contract does not', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-rehearsal-test-'));
  try {
    const allMigrations = createMigrationFixtures(fixtureRoot);
    for (const mode of MODES.filter(
      (candidate) => !CURRENT_ONLY_MODES.has(candidate),
    )) {
      const result = runRehearsal(['--mode', mode], {
        ...requiredMigrationEnvironment(mode, allMigrations),
        TMPDIR: fixtureRoot,
      });
      assertResult(result, 2, 'SETUP_ERROR', 'setup_missing_fixture_contract');
      assert.doesNotMatch(result.stdout, /legacy-rehearsal-test-/);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('script statically locks shell safety, cleanup, modes, and public-safe boundaries', () => {
  const source = readFileSync(rehearsalPath, 'utf8');
  const modeBlock = source.match(/readonly MODES=\(([\s\S]*?)\n\)/);
  assert.ok(modeBlock);
  const declaredModes = [...modeBlock[1].matchAll(/'([^']+)'/g)].map(
    (match) => match[1],
  );
  const declaredMigrationNames = [
    ...new Set(
      source.match(/LEGACY_SUBMISSION_(?:EXPAND|BRIDGE|CONTRACT)_MIGRATION/g),
    ),
  ];

  assert.match(source, /^#!\/usr\/bin\/env bash\nset -euo pipefail\n/);
  assert.match(source, /mktemp -d/);
  assert.match(source, /trap on_exit EXIT/);
  assert.match(source, /docker compose -p/);
  assert.match(source, /fixture_compose down --volumes --remove-orphans/);
  assert.match(source, /postgres:17-alpine@sha256:[a-f0-9]{64}/);
  assert.match(source, /\[\[ -z \$\{DOCKER_HOST:-\} \]\]/);
  assert.match(source, /unix:\/\/\* \| npipe:\/\/\*/);
  assert.deepEqual(declaredModes, MODES);
  assert.equal(new Set(declaredModes).size, 11);
  assert.deepEqual(
    declaredMigrationNames.sort(),
    [...MIGRATION_ENV_NAMES].sort(),
  );
  assert.match(source, /LEGACY_SUBMISSION_REHEARSAL_DRY_RUN/);
  assert.doesNotMatch(source, /\b(?:ssh|scp|rsync|gh|curl|wget)\b/);
  assert.doesNotMatch(
    source,
    /(?:https?:\/\/|\.internal\b|prod(?:uction)?[-.])/i,
  );
  assert.doesNotMatch(source, /\/(?:Users|home)\//);
});

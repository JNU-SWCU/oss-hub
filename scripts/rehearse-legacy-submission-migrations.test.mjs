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
const schemaPath = fileURLToPath(
  new URL('../apps/backend/prisma/schema.prisma', import.meta.url),
);
const expandMigrationDirectory = fileURLToPath(
  new URL(
    '../apps/backend/prisma/migrations/20260830050000_expand_legacy_submission_bridge/',
    import.meta.url,
  ),
);
const expandMigrationPath = join(expandMigrationDirectory, 'migration.sql');
const bridgeMigrationDirectory = fileURLToPath(
  new URL(
    '../apps/backend/prisma/migrations/20260830100000_bridge_legacy_submissions/',
    import.meta.url,
  ),
);
const bridgeMigrationPath = join(bridgeMigrationDirectory, 'migration.sql');
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

test('expand schema and migration add only rollback-safe bridge prerequisites', () => {
  const schema = readFileSync(schemaPath, 'utf8');
  const migration = readFileSync(expandMigrationPath, 'utf8');
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-expand-contract-'));

  try {
    const bridge = join(fixtureRoot, 'bridge');
    mkdirSync(bridge);
    writeFileSync(join(bridge, 'migration.sql'), 'SELECT 1;\n');
    const result = runRehearsal(['--mode', 'bridge-success'], {
      LEGACY_SUBMISSION_REHEARSAL_DRY_RUN: '1',
      LEGACY_SUBMISSION_EXPAND_MIGRATION: expandMigrationDirectory,
      LEGACY_SUBMISSION_BRIDGE_MIGRATION: bridge,
      TMPDIR: fixtureRoot,
    });

    assertResult(result, 0, 'PASS', 'mode_validated');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  assert.match(
    schema,
    /enum MilestoneDocumentKind \{\s+DOCUMENT\s+LEGACY_MILESTONE_SUBMISSION\s+\}/,
  );
  assert.match(schema, /kind\s+MilestoneDocumentKind\s+@default\(DOCUMENT\)/);
  assert.match(schema, /legacySubmissionId\s+String\?\s+@unique/);

  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(migration, /CREATE TYPE "MilestoneDocumentKind" AS ENUM/);
  assert.match(
    migration,
    /ADD COLUMN "kind" "MilestoneDocumentKind" NOT NULL DEFAULT 'DOCUMENT'/,
  );
  assert.match(migration, /ADD COLUMN "legacySubmissionId" TEXT/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "MilestoneDocument_one_legacy_submission_slot_key"[\s\S]*WHERE "kind" = 'LEGACY_MILESTONE_SUBMISSION'/,
  );
  const dropIndex = migration.indexOf(
    'DROP CONSTRAINT "SubmissionFile_lifecycle_attachment_check"',
  );
  const addIndex = migration.indexOf(
    'ADD CONSTRAINT "SubmissionFile_lifecycle_attachment_check"',
  );
  assert.ok(dropIndex >= 0 && addIndex > dropIndex);

  assert.match(
    migration,
    /"submissionRevisionId" IS NOT NULL\s+AND "milestoneDocumentSubmissionId" IS NULL\s+AND "milestoneDocumentSubmissionHistoryId" IS NULL/,
  );
  assert.match(
    migration,
    /"submissionRevisionId" IS NOT NULL\s+AND "milestoneDocumentSubmissionId" IS NOT NULL\s+AND "milestoneDocumentSubmissionHistoryId" IS NOT NULL/,
  );
  assert.match(
    migration,
    /"submissionRevisionId" IS NULL\s+AND "milestoneDocumentSubmissionId" IS NOT NULL\s+AND "milestoneDocumentSubmissionHistoryId" IS NOT NULL/,
  );
  assert.doesNotMatch(
    migration,
    /\b(?:INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|DROP\s+COLUMN)\b/i,
  );
});

test('bridge migration copies exact history and installs fail-closed fences', () => {
  const migration = readFileSync(bridgeMigrationPath, 'utf8');
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-bridge-contract-'));
  try {
    const result = runRehearsal(['--mode', 'bridge-success'], {
      LEGACY_SUBMISSION_REHEARSAL_DRY_RUN: '1',
      LEGACY_SUBMISSION_EXPAND_MIGRATION: expandMigrationDirectory,
      LEGACY_SUBMISSION_BRIDGE_MIGRATION: bridgeMigrationDirectory,
      TMPDIR: fixtureRoot,
    });
    assertResult(result, 0, 'PASS', 'mode_validated');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(
    migration,
    /LOCK TABLE "Submission", "SubmissionRevision", "Review", "SubmissionFile"/,
  );
  assert.match(migration, /legacy_document_/);
  assert.match(migration, /legacy_submission_revision_/);
  assert.match(migration, /legacy_review_event_/);
  assert.match(migration, /"submissionRevisionId" = revision\."id"/);
  assert.match(
    migration,
    /legacy submission bridge count reconciliation failed/,
  );
  assert.match(
    migration,
    /legacy submission bridge field reconciliation failed/,
  );
  assert.match(migration, /CREATE TRIGGER "Submission_bridge_write_fence"/);
  assert.match(
    migration,
    /CREATE TRIGGER "SubmissionFile_bridge_provenance_fence"/,
  );
  assert.match(migration, /TG_OP = 'INSERT'/);
  assert.match(migration, /TG_OP = 'DELETE'/);
  assert.match(migration, /IS DISTINCT FROM OLD\."submissionRevisionId"/);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN)/i);
  assert.doesNotMatch(
    migration,
    /DELETE\s+FROM\s+"(?:Submission|SubmissionRevision|Review)"/i,
  );
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

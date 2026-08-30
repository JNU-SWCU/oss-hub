#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const INPUT_SCHEMA = 'oss-hub.legacy-submission-report-input.v1';
const OUTPUT_SCHEMA = 'oss-hub.legacy-submission-report.v1';
const MODES = new Set(['baseline', 'post-bridge', 'ready-for-contract']);
const LIFECYCLES = ['PENDING', 'ATTACHED', 'DELETE_PENDING', 'DELETED'];
const MISMATCH_KEYS = [
  'submissions',
  'revisions',
  'reviews',
  'reviewEvents',
  'files',
  'currentHeaders',
];
const TOP_LEVEL_KEYS = [
  'schema',
  'source',
  'target',
  'mismatches',
  'orphans',
  'unmappedNonSeed',
  'allSeedCandidates',
  'runtimeLegacyAccess',
  'legacyWritesAfterCutover',
  'provenanceDigest',
  'baselineProvenanceDigest',
  'migrationLedger',
  'restore',
];

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const raw = options.inputPath
    ? await readFile(options.inputPath, 'utf8')
    : await readStdin();
  const input = parseInput(raw);
  const gates = buildGates(options.mode, input);
  const status = gates.every((gate) => gate.status === 'PASS')
    ? 'PASS'
    : 'FAIL';
  const report = {
    schema: OUTPUT_SCHEMA,
    mode: options.mode,
    status,
    counts: {
      source: input.source,
      target: input.target,
      mismatches: input.mismatches,
      orphans: input.orphans,
      unmappedNonSeed: input.unmappedNonSeed,
      allSeedCandidates: input.allSeedCandidates,
      runtimeLegacyAccess: input.runtimeLegacyAccess,
      legacyWritesAfterCutover: input.legacyWritesAfterCutover,
      migrationLedger: input.migrationLedger,
    },
    gates,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (status === 'FAIL') process.exitCode = 1;
}

async function readStdin() {
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function parseArguments(args) {
  let mode;
  let inputPath;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--mode' && mode === undefined) {
      if (args[index + 1] === undefined)
        throw new TypeError('Invalid arguments');
      mode = args[index + 1];
      index += 1;
    } else if (argument === '--input' && inputPath === undefined) {
      if (args[index + 1] === undefined)
        throw new TypeError('Invalid arguments');
      inputPath = args[index + 1];
      index += 1;
    } else if (argument === '--json' && !json) {
      json = true;
    } else {
      throw new TypeError('Invalid arguments');
    }
  }
  if (
    !json ||
    !MODES.has(mode) ||
    (inputPath !== undefined &&
      (inputPath.length === 0 || inputPath.startsWith('--')))
  ) {
    throw new TypeError('Invalid arguments');
  }
  return { mode, inputPath };
}

function parseInput(raw) {
  const value = JSON.parse(raw);
  exactRecord(value, TOP_LEVEL_KEYS);
  if (value.schema !== INPUT_SCHEMA) throw new TypeError('Invalid schema');
  const source = exactRecord(value.source, [
    'submissions',
    'revisions',
    'reviews',
    'filesByLifecycle',
  ]);
  const target = exactRecord(value.target, [
    'internalSlots',
    'headers',
    'histories',
    'reviewHistories',
    'reviewEvents',
    'linkedFilesByLifecycle',
  ]);
  const mismatches = exactRecord(value.mismatches, MISMATCH_KEYS);
  const migrationLedger = exactRecord(value.migrationLedger, [
    'bridgeApplied',
    'unfinished',
  ]);
  const restore = exactRecord(value.restore, ['database', 'objects']);
  return {
    schema: value.schema,
    source: {
      submissions: count(source.submissions),
      revisions: count(source.revisions),
      reviews: count(source.reviews),
      filesByLifecycle: countRecord(source.filesByLifecycle, LIFECYCLES),
    },
    target: {
      internalSlots: count(target.internalSlots),
      headers: count(target.headers),
      histories: count(target.histories),
      reviewHistories: count(target.reviewHistories),
      reviewEvents: count(target.reviewEvents),
      linkedFilesByLifecycle: countRecord(
        target.linkedFilesByLifecycle,
        LIFECYCLES,
      ),
    },
    mismatches: Object.fromEntries(
      MISMATCH_KEYS.map((key) => [key, count(mismatches[key])]),
    ),
    orphans: count(value.orphans),
    unmappedNonSeed: count(value.unmappedNonSeed),
    allSeedCandidates: count(value.allSeedCandidates),
    runtimeLegacyAccess: count(value.runtimeLegacyAccess),
    legacyWritesAfterCutover: count(value.legacyWritesAfterCutover),
    provenanceDigest: digest(value.provenanceDigest),
    baselineProvenanceDigest: digest(value.baselineProvenanceDigest),
    migrationLedger: {
      bridgeApplied: count(migrationLedger.bridgeApplied),
      unfinished: count(migrationLedger.unfinished),
    },
    restore: {
      database: restoreStatus(restore.database),
      objects: restoreStatus(restore.objects),
    },
  };
}

function buildGates(mode, input) {
  const gates = [gate('all-seed-candidates-zero', input.allSeedCandidates, 0)];
  if (mode === 'baseline') return gates;

  gates.unshift(
    gate(
      'source-target-submissions',
      input.target.headers,
      input.source.submissions,
    ),
    gate(
      'source-target-revisions',
      input.target.histories,
      input.source.revisions,
    ),
    gate(
      'source-target-review-histories',
      input.target.reviewHistories,
      input.source.reviews,
    ),
    gate(
      'source-target-review-events',
      input.target.reviewEvents,
      input.source.reviews,
    ),
    ...LIFECYCLES.map((lifecycle) =>
      gate(
        `source-target-files-${lifecycle.toLowerCase().replace('_', '-')}`,
        input.target.linkedFilesByLifecycle[lifecycle],
        input.source.filesByLifecycle[lifecycle],
      ),
    ),
    ...Object.entries(input.mismatches).map(([key, actual]) =>
      gate(`mismatches-${camelToKebab(key)}-zero`, actual, 0),
    ),
    gate('orphans-zero', input.orphans, 0),
    gate('unmapped-non-seed-zero', input.unmappedNonSeed, 0),
    gate(
      'provenance-digest-present',
      input.provenanceDigest === null ? 'missing' : 'present',
      'present',
    ),
    gate(
      'provenance-digest-baseline-match',
      input.provenanceDigest !== null &&
        input.baselineProvenanceDigest !== null &&
        input.provenanceDigest === input.baselineProvenanceDigest
        ? 'match'
        : 'mismatch',
      'match',
    ),
    gate('bridge-applied', input.migrationLedger.bridgeApplied, 1),
    gate('migration-unfinished-zero', input.migrationLedger.unfinished, 0),
  );
  if (mode === 'ready-for-contract') {
    gates.push(
      gate('runtime-legacy-access-zero', input.runtimeLegacyAccess, 0),
      gate(
        'legacy-writes-after-cutover-zero',
        input.legacyWritesAfterCutover,
        0,
      ),
      gate('database-restore-passed', input.restore.database, 'passed'),
      gate('object-restore-passed', input.restore.objects, 'passed'),
    );
  }
  return gates;
}

function gate(id, actual, expected) {
  return {
    id,
    status: actual === expected ? 'PASS' : 'FAIL',
    actual,
    expected,
  };
}

function exactRecord(value, keys) {
  if (!record(value)) throw new TypeError('Invalid object');
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new TypeError('Invalid keys');
  }
  return value;
}

function countRecord(value, keys) {
  const counts = exactRecord(value, keys);
  return Object.fromEntries(keys.map((key) => [key, count(counts[key])]));
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Invalid count');
  }
  return value;
}

function digest(value) {
  if (
    value !== null &&
    (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
  ) {
    throw new TypeError('Invalid digest');
  }
  return value;
}

function restoreStatus(value) {
  if (!['not_run', 'passed', 'failed'].includes(value)) {
    throw new TypeError('Invalid restore status');
  }
  return value;
}

function camelToKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main().catch(() => {
  process.stderr.write('legacy-submission-production-report: invalid input\n');
  process.exitCode = 2;
});

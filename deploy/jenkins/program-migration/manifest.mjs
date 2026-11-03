import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]*$/;
const MIGRATION = /^[0-9]{14}_[a-z0-9_]+$/;

function fail(message) {
  console.error(`FAIL_CLOSED manifest: ${message}`);
  process.exit(1);
}

function onlyKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${label} has unknown key ${key}`);
  }
}

function text(value, label) {
  if (typeof value !== 'string' || value === '' || /[\r\n]/.test(value)) {
    fail(`${label} must be a single-line string`);
  }
  return value;
}

function id(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) {
    fail(`${label} must match ${ID}`);
  }
  return value;
}

function file(base, value, label) {
  const path = resolve(base, text(value, label));
  let isFile = false;
  try {
    isFile = statSync(path).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) fail(`${label} is not a file: ${value}`);
  return path;
}

function files(base, value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (value.length === 0 && !allowEmpty)) {
    fail(`${label} must be a ${allowEmpty ? '' : 'non-empty '}array`);
  }
  return value.map((entry, index) => file(base, entry, `${label}[${index}]`));
}

function argv(base, value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${label} must be a non-empty array`);
  }
  const [command, ...rest] = value.map((entry, index) =>
    text(entry, `${label}[${index}]`),
  );
  return [
    command.includes('/') ? file(base, command, label) : command,
    ...rest,
  ];
}

function load(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot read ${path}: ${error.code ?? error.name}`);
  }
  const base = dirname(resolve(path));
  onlyKeys(
    raw,
    [
      'version',
      'name',
      'expectedHeadMigration',
      'preflight',
      'stages',
      'backupBeforeStage',
      'counts',
      'cutover',
      'objectMirror',
    ],
    'manifest',
  );
  if (raw.version !== 1) fail('version must be 1');
  if (
    typeof raw.expectedHeadMigration !== 'string' ||
    !MIGRATION.test(raw.expectedHeadMigration)
  ) {
    fail(`expectedHeadMigration must match ${MIGRATION}`);
  }
  if (!Array.isArray(raw.stages) || raw.stages.length === 0) {
    fail('stages must be a non-empty array');
  }
  const stages = raw.stages.map((stage, index) => {
    const label = `stages[${index}]`;
    onlyKeys(stage, ['id', 'apply', 'reconcile'], label);
    return {
      id: id(stage.id, `${label}.id`),
      apply: files(base, stage.apply, `${label}.apply`, { allowEmpty: true }),
      reconcile: files(base, stage.reconcile, `${label}.reconcile`),
    };
  });
  const stageIds = stages.map((stage) => stage.id);
  if (new Set(stageIds).size !== stageIds.length)
    fail('stage ids must be unique');
  const backupIndex = stageIds.indexOf(raw.backupBeforeStage);
  if (backupIndex < 0) fail('backupBeforeStage must name a stage');
  if (!Array.isArray(raw.counts) || raw.counts.length === 0) {
    fail('counts must be a non-empty array');
  }
  const counts = raw.counts.map((count, index) => {
    const label = `counts[${index}]`;
    onlyKeys(count, ['name', 'file'], label);
    return {
      name: id(count.name, `${label}.name`),
      file: file(base, count.file, `${label}.file`),
    };
  });
  const countNames = counts.map((count) => count.name);
  if (new Set(countNames).size !== countNames.length) {
    fail('count names must be unique');
  }
  let cutover = null;
  if (raw.cutover !== undefined) {
    onlyKeys(
      raw.cutover,
      ['afterStage', 'write', 'previousImageCheck', 'oldStructureReconcile'],
      'cutover',
    );
    const cutoverIndex = stageIds.indexOf(raw.cutover.afterStage);
    if (cutoverIndex < 0) fail('cutover.afterStage must name a stage');
    if (cutoverIndex >= backupIndex) {
      fail('cutover must finish before the backup that precedes deletion');
    }
    cutover = {
      afterStage: raw.cutover.afterStage,
      write: files(base, raw.cutover.write, 'cutover.write'),
      previousImageCheck: argv(
        base,
        raw.cutover.previousImageCheck,
        'cutover.previousImageCheck',
      ),
      oldStructureReconcile: files(
        base,
        raw.cutover.oldStructureReconcile,
        'cutover.oldStructureReconcile',
      ),
    };
  }
  return {
    name: id(raw.name, 'name'),
    expectedHeadMigration: raw.expectedHeadMigration,
    preflight: files(base, raw.preflight, 'preflight'),
    stages,
    backupBeforeStage: raw.backupBeforeStage,
    counts,
    cutover,
    objectMirror:
      raw.objectMirror === undefined
        ? []
        : argv(base, raw.objectMirror, 'objectMirror'),
  };
}

function stage(manifest, stageId) {
  const found = manifest.stages.find((entry) => entry.id === stageId);
  if (!found) fail(`unknown stage ${stageId}`);
  return found;
}

const [path, query, argument] = process.argv.slice(2);
if (!path || !query) fail('usage: manifest.mjs <manifest> <query> [stage-id]');
const manifest = load(path);
const queries = {
  validate: () => [],
  name: () => [manifest.name],
  head: () => [manifest.expectedHeadMigration],
  preflight: () => manifest.preflight,
  'stage-ids': () => manifest.stages.map((entry) => entry.id),
  'stage-apply': () => stage(manifest, argument).apply,
  'stage-reconcile': () => stage(manifest, argument).reconcile,
  'backup-before': () => [manifest.backupBeforeStage],
  'count-names': () => manifest.counts.map((count) => count.name),
  'count-files': () => manifest.counts.map((count) => count.file),
  'cutover-after': () =>
    manifest.cutover ? [manifest.cutover.afterStage] : [],
  'cutover-write': () => manifest.cutover?.write ?? [],
  'cutover-previous-image': () => manifest.cutover?.previousImageCheck ?? [],
  'cutover-old-reconcile': () => manifest.cutover?.oldStructureReconcile ?? [],
  'object-mirror': () => manifest.objectMirror,
};
if (!Object.hasOwn(queries, query)) fail(`unknown query ${query}`);
for (const line of queries[query]()) console.log(line);

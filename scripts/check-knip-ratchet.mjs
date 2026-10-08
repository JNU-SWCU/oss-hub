import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertJointRetirement,
  parseArguments,
  resolvePredecessor,
} from './check-lint-ratchet.mjs';

const KNIP_VERSION = '6.40.0';
const ISSUE_TYPES = [
  'files',
  'exports',
  'types',
  'dependencies',
  'devDependencies',
  'unlisted',
  'binaries',
];
const WORKSPACES = ['.', 'apps/backend', 'apps/frontend'];
const BASELINE = 'knip-baseline.json';
const CHECKERS = [
  'scripts/check-lint-ratchet.mjs',
  'scripts/check-knip-ratchet.mjs',
];
const REPORT_TYPES = new Set([
  ...ISSUE_TYPES,
  'optionalPeerDependencies',
  'nsExports',
  'nsTypes',
  'enumMembers',
  'namespaceMembers',
  'duplicates',
  'unresolved',
  'catalog',
  'catalogReferences',
  'cycles',
]);

function fail(code, message) {
  throw new Error(`${code}: ${message}`);
}

function git(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  } catch {
    fail('base-unavailable', `git ${args[0]} failed`);
  }
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keysEqual(value, keys) {
  return (
    object(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',')
  );
}

function validateCounts(counts) {
  if (!keysEqual(counts, WORKSPACES))
    fail(
      'budget-schema',
      'all three workspaces are required, with no extra keys',
    );
  for (const workspace of WORKSPACES) {
    if (!keysEqual(counts[workspace], ISSUE_TYPES))
      fail(
        'budget-schema',
        `${workspace}: every issue type is required, including zeros`,
      );
    for (const type of ISSUE_TYPES) {
      const value = counts[workspace][type];
      if (!Number.isSafeInteger(value) || value < 0)
        fail(
          'budget-schema',
          `${workspace}/${type}: expected nonnegative safe integer`,
        );
    }
  }
  return counts;
}

export function parseBudget(content) {
  let budget;
  try {
    budget = JSON.parse(content);
  } catch {
    fail('budget-schema', 'invalid JSON');
  }
  if (!keysEqual(budget, ['version', 'workspaces']) || budget.version !== 1)
    fail('budget-schema', 'expected version 1 and workspaces');
  return validateCounts(budget.workspaces);
}

function encodeBudget(counts) {
  return `${JSON.stringify({ version: 1, workspaces: Object.fromEntries(WORKSPACES.map((workspace) => [workspace, Object.fromEntries(ISSUE_TYPES.map((type) => [type, counts[workspace][type]]))])) }, null, 2)}\n`;
}

function readHeadBudget(root) {
  const file = path.join(root, BASELINE);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || fs.realpathSync(file) !== file)
    fail('budget-schema', 'baseline must be a regular non-symlink file');
  return parseBudget(fs.readFileSync(file, 'utf8'));
}

function readPredecessor(root, sha) {
  const tree = new Map();
  for (const record of git(root, ['ls-tree', '-rz', '--full-tree', sha])
    .split('\0')
    .filter(Boolean)) {
    const tab = record.indexOf('\t');
    tree.set(record.slice(tab + 1), record.slice(0, tab));
  }
  const metadata = tree.get(BASELINE);
  if (metadata && !/^100(?:644|755) blob /.test(metadata))
    fail('budget-schema', 'predecessor baseline is not a regular blob');
  const budget = metadata
    ? parseBudget(git(root, ['show', `${sha}:${BASELINE}`]))
    : null;
  const introduced =
    CHECKERS.some((file) => tree.has(file)) ||
    [...tree.keys()].some((file) =>
      /^apps\/(backend|frontend)\/lint-baseline\//.test(file),
    );
  return { budget, introduced };
}

function requireAtMost(left, right, code) {
  for (const workspace of WORKSPACES) {
    for (const type of ISSUE_TYPES) {
      if (left[workspace][type] > right[workspace][type])
        fail(
          code,
          `${workspace}/${type}: ${left[workspace][type]} > ${right[workspace][type]}`,
        );
    }
  }
}

function total(counts) {
  return WORKSPACES.reduce(
    (sum, workspace) =>
      sum +
      ISSUE_TYPES.reduce(
        (subtotal, type) => subtotal + counts[workspace][type],
        0,
      ),
    0,
  );
}

function workspaceOf(file) {
  if (
    typeof file !== 'string' ||
    !file ||
    file.includes('\\') ||
    file.includes('\0') ||
    file.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    fail(
      'report-schema',
      'report file must be a normalized repository-relative path',
    );
  }
  const workspace = WORKSPACES.slice(1).find((candidate) =>
    file.startsWith(`${candidate}/`),
  );
  if (!workspace && file.startsWith('apps/'))
    fail('report-schema', 'unknown app workspace');
  return workspace ?? '.';
}

export function countKnipReport(report) {
  if (!keysEqual(report, ['issues']) || !Array.isArray(report.issues))
    fail('report-schema', 'expected Knip 6.40.0 {issues: []} report');
  const counts = Object.fromEntries(
    WORKSPACES.map((workspace) => [
      workspace,
      Object.fromEntries(ISSUE_TYPES.map((type) => [type, 0])),
    ]),
  );
  const files = new Set();
  for (const row of report.issues) {
    if (!object(row)) fail('report-schema', 'issue row must be an object');
    const workspace = workspaceOf(row.file);
    if (files.has(row.file)) fail('report-schema', 'duplicate file row');
    files.add(row.file);
    for (const [type, findings] of Object.entries(row)) {
      if (type === 'file') continue;
      if (type !== 'owners' && !REPORT_TYPES.has(type))
        fail('report-schema', `unknown issue category ${type}`);
      if (!Array.isArray(findings))
        fail('report-schema', `${type} must be an array`);
      if (type === 'owners') {
        if (
          !findings.every(
            (entry) => object(entry) && typeof entry.name === 'string',
          )
        )
          fail('report-schema', 'invalid owner metadata');
        continue;
      }
      if (!ISSUE_TYPES.includes(type)) {
        if (findings.length)
          fail(
            'unsupported-issue-type',
            `${type} requires an explicit budget contract decision`,
          );
        continue;
      }
      if (
        !findings.every(
          (entry) =>
            object(entry) &&
            typeof entry.name === 'string' &&
            entry.name.length > 0,
        )
      )
        fail('report-schema', `${type} findings require names`);
      counts[workspace][type] += findings.length;
    }
  }
  return validateCounts(counts);
}

function collectKnipCounts(root) {
  const require = createRequire(path.join(root, 'package.json'));
  const packageRoot = path.resolve(path.dirname(require.resolve('knip')), '..');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
  );
  if (manifest.version !== KNIP_VERSION)
    fail(
      'knip-version',
      `expected ${KNIP_VERSION}; install the pinned root dependency`,
    );
  const result = spawnSync(
    process.execPath,
    [
      path.join(packageRoot, 'bin/knip.js'),
      '--config',
      'knip.json',
      '--reporter',
      'json',
      '--no-progress',
      '--include',
      ISSUE_TYPES.join(','),
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.signal || ![0, 1].includes(result.status))
    fail('knip-execution', 'Knip did not complete its analysis');
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    fail('report-schema', 'Knip did not emit a JSON report');
  }
  const counts = countKnipReport(report);
  if (result.status === 1 && total(counts) === 0)
    fail('knip-execution', 'nonzero exit without countable findings');
  return counts;
}

export async function runKnipRatchet(
  root,
  options,
  collect = collectKnipCounts,
) {
  const baseSha = resolvePredecessor(root, options);
  const predecessor = readPredecessor(root, baseSha);
  const head = readHeadBudget(root);
  let mode;
  if (predecessor.budget !== null) {
    mode = 'ratchet';
    if (options.seed)
      fail('seed-forbidden', 'a predecessor budget already exists');
    if (head !== null) requireAtMost(head, predecessor.budget, 'budget-growth');
  } else if (!predecessor.introduced) {
    mode = 'seed';
    if (
      !CHECKERS.every((file) => {
        const absolute = path.join(root, file);
        return (
          fs.existsSync(absolute) &&
          fs.lstatSync(absolute).isFile() &&
          fs.realpathSync(absolute) === absolute
        );
      })
    )
      fail('seed-checkers-missing', 'P1 must introduce both checkers');
    if (options.seed && head !== null)
      fail('seed-forbidden', 'head baseline already exists');
    if (!options.seed && head === null)
      fail('baseline-missing', 'seed checking requires an exact head budget');
  } else {
    mode = 'retired';
    if (options.seed)
      fail('seed-forbidden', 'checker history prevents reseeding');
    if (head !== null)
      fail('baseline-missing', 'predecessor has checkers but lacks a budget');
  }
  const actual = validateCounts(await collect(root));
  if (mode === 'retired' || (mode === 'ratchet' && head === null)) {
    if (total(actual) !== 0)
      fail(
        'retirement-nonzero',
        'removing or retiring the budget requires zero findings',
      );
    assertJointRetirement(root);
    return { mode, baseSha, counts: actual };
  }
  if (options.seed) {
    fs.writeFileSync(path.join(root, BASELINE), encodeBudget(actual), {
      flag: 'wx',
    });
  } else {
    requireAtMost(actual, head, 'finding-growth');
    if (!options.prune || mode === 'seed')
      requireAtMost(head, actual, 'stale-budget');
    if (options.prune)
      fs.writeFileSync(path.join(root, BASELINE), encodeBudget(actual));
  }
  return { mode, baseSha, counts: actual };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const result = await runKnipRatchet(root, options);
  const rows = WORKSPACES.flatMap((workspace) =>
    ISSUE_TYPES.map(
      (type) =>
        `| ${workspace} | ${type} | ${result.counts[workspace][type]} |`,
    ),
  );
  const summary = [
    `Knip ratchet: ${result.mode}; Knip ${KNIP_VERSION}; predecessor ${result.baseSha}; ${total(result.counts)} findings`,
    '',
    '| Workspace | Issue type | Count |',
    '| --- | --- | ---: |',
    ...rows,
    '',
  ].join('\n');
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`knip-ratchet: ${error.message}`);
    process.exitCode = 1;
  });
}

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  countKnipReport,
  parseBudget,
  runKnipRatchet,
} from './check-knip-ratchet.mjs';
import { runRatchet } from './check-lint-ratchet.mjs';

const CHECKER = fileURLToPath(
  new URL('./check-knip-ratchet.mjs', import.meta.url),
);
const ZERO = {
  files: 0,
  exports: 0,
  types: 0,
  dependencies: 0,
  devDependencies: 0,
  unlisted: 0,
  binaries: 0,
};
const BASELINE = 'knip-baseline.json';

function counts(backend = {}, frontend = {}, root = {}) {
  return {
    '.': { ...ZERO, ...root },
    'apps/backend': { ...ZERO, ...backend },
    'apps/frontend': { ...ZERO, ...frontend },
  };
}

function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'knip-ratchet-')),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const remove = (file) =>
    fs.rmSync(path.join(root, file), { recursive: true, force: true });
  const commit = () => {
    git('add', '.');
    git('commit', '--quiet', '--allow-empty', '-m', 'synthetic fixture');
    return git('rev-parse', 'HEAD');
  };
  const budget = (value) =>
    write(BASELINE, JSON.stringify({ version: 1, workspaces: value }));
  const checkers = () => {
    write('scripts/check-lint-ratchet.mjs', 'export {};\n');
    write('scripts/check-knip-ratchet.mjs', 'export {};\n');
  };
  const options = (baseSha, extra = {}) => ({
    event: 'push',
    baseSha,
    headSha: git('rev-parse', 'HEAD'),
    ...extra,
  });
  const run = (baseSha, actual, extra = {}) =>
    runKnipRatchet(root, options(baseSha, extra), () => actual);
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Synthetic Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  write('package.json', '{"private":true}\n');
  return { root, git, write, remove, commit, budget, checkers, options, run };
}

function existing(t, current = counts({ exports: 2 })) {
  const repo = fixture(t);
  repo.checkers();
  repo.budget(current);
  return { ...repo, base: repo.commit() };
}

test('B2 Knip cannot remove its budget while the lint family retains debt', async (t) => {
  const repo = existing(t, counts());
  repo.write('apps/backend/src/sample/example.js', 'debugger;\n');
  repo.write(
    'apps/backend/lint-baseline/sample.ndjson',
    `${JSON.stringify({
      file: 'apps/backend/src/sample/example.js',
      ruleId: 'no-debugger',
      target: 'retained-debugger',
    })}\n`,
  );
  const jointBase = repo.commit();
  repo.remove(BASELINE);
  const partialBase = repo.commit();
  await assert.rejects(
    repo.run(jointBase, counts()),
    /retire|retirement|baseline-missing/,
  );
  repo.commit();
  await assert.rejects(
    repo.run(partialBase, counts()),
    /retire|retirement|baseline-missing/,
  );
});

test('B2 Knip permits joint zero removal and the following retired predecessor', async (t) => {
  const repo = existing(t, counts());
  repo.write('apps/backend/lint-baseline/root.ndjson', '');
  repo.write('apps/frontend/lint-baseline/root.ndjson', '');
  const jointBase = repo.commit();
  repo.remove(BASELINE);
  repo.remove('apps/backend/lint-baseline');
  repo.remove('apps/frontend/lint-baseline');
  const retiredBase = repo.commit();
  assert.deepEqual((await repo.run(jointBase, counts())).counts, counts());
  repo.commit();
  assert.equal((await repo.run(retiredBase, counts())).mode, 'retired');
});

test('Knip retains its zero marker while even empty lint shards remain', async (t) => {
  const repo = existing(t, counts());
  repo.write('apps/backend/lint-baseline/root.ndjson', '');
  const jointBase = repo.commit();
  repo.remove(BASELINE);
  repo.commit();
  await assert.rejects(repo.run(jointBase, counts()), /joint-retirement/);
});

test('the combined retirement gate requires actual zero findings from both checkers', async (t) => {
  const repo = existing(t, counts());
  const file = 'apps/backend/src/sample/example.js';
  repo.write(file, 'debugger;\n');
  repo.write('apps/backend/lint-baseline/root.ndjson', '');
  repo.write('apps/frontend/lint-baseline/root.ndjson', '');
  const jointBase = repo.commit();
  repo.remove(BASELINE);
  repo.remove('apps/backend/lint-baseline');
  repo.remove('apps/frontend/lint-baseline');
  const retiredBase = repo.commit();
  const combined = async (base, diagnostics, actual) => {
    await runRatchet(repo.root, repo.options(base), () => ({
      diagnostics,
      allowedRuleIds: {
        backend: new Set(['no-debugger']),
        frontend: new Set(['no-debugger']),
      },
    }));
    return repo.run(base, actual);
  };
  const lintDebt = [{ file, ruleId: 'no-debugger', target: 'actual-debt' }];
  await assert.rejects(
    combined(jointBase, lintDebt, counts()),
    /unlisted-diagnostic/,
  );
  await assert.rejects(
    combined(jointBase, [], counts({ exports: 1 })),
    /retirement-nonzero/,
  );
  assert.deepEqual((await combined(jointBase, [], counts())).counts, counts());
  repo.commit();
  await assert.rejects(
    combined(retiredBase, lintDebt, counts()),
    /baseline-missing/,
  );
  await assert.rejects(
    combined(retiredBase, [], counts({ exports: 1 })),
    /retirement-nonzero/,
  );
  assert.equal((await combined(retiredBase, [], counts())).mode, 'retired');
});

test('simultaneous budget and finding growth fails before collecting actual counts', async (t) => {
  const repo = existing(t);
  repo.budget(counts({ exports: 3 }));
  const head = repo.commit();
  repo.git('update-ref', 'refs/remotes/origin/main', head);
  let collected = false;
  await assert.rejects(
    runKnipRatchet(repo.root, repo.options(repo.base), () => {
      collected = true;
      return counts({ exports: 3 });
    }),
    /budget-growth/,
  );
  assert.equal(collected, false);
  await assert.rejects(
    repo.run(repo.base, counts({ exports: 1 }), { prune: true }),
    /budget-growth/,
  );
});

test('unchanged main-push budget passes without comparing against origin/main', async (t) => {
  const repo = existing(t);
  const head = repo.commit();
  repo.git('update-ref', 'refs/remotes/origin/main', head);
  const result = await repo.run(repo.base, counts({ exports: 2 }));
  assert.equal(result.mode, 'ratchet');
  assert.equal(result.baseSha, repo.base);
});

test('growth, stale counts and coordinated reductions use exact per-type budgets', async (t) => {
  const repo = existing(t);
  repo.commit();
  await assert.rejects(
    repo.run(repo.base, counts({ exports: 3 })),
    /finding-growth/,
  );
  await assert.rejects(
    repo.run(repo.base, counts({ exports: 1 })),
    /stale-budget/,
  );
  repo.budget(counts({ exports: 1 }));
  repo.commit();
  assert.deepEqual(
    (await repo.run(repo.base, counts({ exports: 1 }))).counts,
    counts({ exports: 1 }),
  );
  repo.budget(counts({ exports: 1, types: 1 }));
  repo.commit();
  await assert.rejects(
    repo.run(repo.base, counts({ exports: 1, types: 1 })),
    /budget-growth/,
  );
});

test('budgets cannot transfer debt between workspaces or categories', async (t) => {
  const repo = existing(t, counts({ exports: 1 }, {}, { files: 1 }));
  repo.budget(counts({}, { exports: 1 }, { files: 1 }));
  repo.commit();
  await assert.rejects(
    repo.run(repo.base, counts({}, { exports: 1 }, { files: 1 })),
    /budget-growth/,
  );
  repo.budget(counts({ exports: 1 }, {}, { dependencies: 1 }));
  repo.commit();
  await assert.rejects(
    repo.run(repo.base, counts({ exports: 1 }, {}, { dependencies: 1 })),
    /budget-growth/,
  );
});

test('missing workspace or issue keys and invalid numeric budgets fail closed', async (t) => {
  for (const mutate of [
    (value) => {
      delete value['apps/frontend'];
    },
    (value) => {
      delete value['apps/backend'].files;
    },
    (value) => {
      value['apps/backend'].exports = -1;
    },
    (value) => {
      value['apps/backend'].exports = 0.5;
    },
    (value) => {
      value['apps/backend'].exports = '0';
    },
    (value) => {
      value['apps/backend'].exports = Number.MAX_SAFE_INTEGER + 1;
    },
    (value) => {
      value['apps/other'] = { ...ZERO };
    },
    (value) => {
      value['.'].unknown = 0;
    },
  ]) {
    const repo = existing(t);
    const value = counts();
    mutate(value);
    repo.budget(value);
    repo.commit();
    await assert.rejects(repo.run(repo.base, counts()), /budget-schema/);
  }
  assert.throws(() => parseBudget('{'), /budget-schema/);
  assert.throws(
    () => parseBudget(JSON.stringify({ version: 2, workspaces: counts() })),
    /budget-schema/,
  );
});

test('seed is exact and its writer refuses padding, overwrite and reseeding', async (t) => {
  const repo = fixture(t);
  const base = repo.commit();
  repo.checkers();
  repo.commit();
  const actual = counts({ exports: 2 }, { types: 1 }, { files: 1 });
  assert.equal((await repo.run(base, actual, { seed: true })).mode, 'seed');
  assert.deepEqual(
    parseBudget(fs.readFileSync(path.join(repo.root, BASELINE), 'utf8')),
    actual,
  );
  assert.equal((await repo.run(base, actual)).mode, 'seed');
  await assert.rejects(
    repo.run(base, actual, { seed: true }),
    /seed-forbidden/,
  );
  repo.budget(counts({ exports: 3 }, { types: 1 }, { files: 1 }));
  await assert.rejects(repo.run(base, actual), /stale-budget/);
  await assert.rejects(repo.run(base, actual, { prune: true }), /stale-budget/);
  const seededBase = repo.commit();
  repo.remove(BASELINE);
  repo.commit();
  await assert.rejects(
    repo.run(seededBase, counts(), { seed: true }),
    /seed-forbidden/,
  );
});

test('seed requires both introducing checkers and an exact baseline', async (t) => {
  const repo = fixture(t);
  const base = repo.commit();
  repo.write('scripts/check-knip-ratchet.mjs', 'export {};\n');
  repo.budget(counts());
  repo.commit();
  await assert.rejects(repo.run(base, counts()), /seed-checkers-missing/);
  repo.checkers();
  repo.remove(BASELINE);
  repo.commit();
  await assert.rejects(repo.run(base, counts()), /baseline-missing/);
});

test('either checker or lint-baseline history prevents automatic reseeding', async (t) => {
  for (const marker of [
    'scripts/check-lint-ratchet.mjs',
    'scripts/check-knip-ratchet.mjs',
    'apps/backend/lint-baseline/root.ndjson',
  ]) {
    const repo = fixture(t);
    repo.write(marker, '');
    const base = repo.commit();
    repo.checkers();
    repo.budget(counts());
    repo.commit();
    await assert.rejects(repo.run(base, counts()), /baseline-missing/);
    await assert.rejects(
      repo.run(base, counts(), { seed: true }),
      /seed-forbidden/,
    );
  }
});

test('retirement and baseline deletion pass only with zero actual counts', async (t) => {
  const repo = existing(t);
  repo.remove(BASELINE);
  const retiredBase = repo.commit();
  await assert.rejects(
    repo.run(repo.base, counts({ exports: 1 })),
    /retirement-nonzero/,
  );
  assert.deepEqual((await repo.run(repo.base, counts())).counts, counts());
  repo.commit();
  assert.equal((await repo.run(retiredBase, counts())).mode, 'retired');
  await assert.rejects(
    repo.run(retiredBase, counts({}, { files: 1 })),
    /retirement-nonzero/,
  );
  repo.budget(counts());
  await assert.rejects(repo.run(retiredBase, counts()), /baseline-missing/);
});

test('prune lowers budgets deterministically but never accepts increased actual counts', async (t) => {
  const repo = existing(t);
  repo.commit();
  const actual = counts({ exports: 1 });
  await repo.run(repo.base, actual, { prune: true });
  const first = fs.readFileSync(path.join(repo.root, BASELINE), 'utf8');
  assert.deepEqual(parseBudget(first), actual);
  await repo.run(repo.base, actual, { prune: true });
  assert.equal(fs.readFileSync(path.join(repo.root, BASELINE), 'utf8'), first);
  await assert.rejects(
    repo.run(repo.base, counts({ exports: 2 }), { prune: true }),
    /finding-growth/,
  );
});

test('zero, unavailable, same-head and nonancestor before SHAs fail before collection', async (t) => {
  const repo = existing(t);
  const sibling = repo.commit();
  repo.git('checkout', '--quiet', '--detach', repo.base);
  repo.write('sibling.txt', 'different tree\n');
  const head = repo.commit();
  for (const base of ['0'.repeat(40), 'f'.repeat(40), head, sibling]) {
    let collected = false;
    await assert.rejects(
      runKnipRatchet(repo.root, repo.options(base), () => {
        collected = true;
        return counts();
      }),
      /base-unavailable|non-ancestor-before/,
    );
    assert.equal(collected, false);
  }
});

test('PR budgets come from merge-base rather than newer base-tip entries', async (t) => {
  const repo = existing(t);
  repo.budget(counts({ exports: 4 }));
  const baseTip = repo.commit();
  repo.git('checkout', '--quiet', '--detach', repo.base);
  repo.budget(counts({ exports: 3 }));
  repo.commit();
  await assert.rejects(
    repo.run(baseTip, counts({ exports: 3 }), { event: 'pull_request' }),
    /budget-growth/,
  );
});

test('head and predecessor symlink baselines cannot substitute another file', async (t) => {
  const repo = existing(t);
  repo.remove(BASELINE);
  repo.write(
    'other.json',
    JSON.stringify({ version: 1, workspaces: counts() }),
  );
  fs.symlinkSync('other.json', path.join(repo.root, BASELINE));
  const linkedBase = repo.commit();
  await assert.rejects(repo.run(repo.base, counts()), /budget-schema/);
  repo.remove(BASELINE);
  repo.budget(counts());
  repo.commit();
  await assert.rejects(repo.run(linkedBase, counts()), /budget-schema/);
});

test('Knip 6 report arrays count each named finding in its own workspace', () => {
  const report = {
    issues: [
      {
        file: 'scripts/unused.mjs',
        files: [{ name: 'scripts/unused.mjs' }],
        owners: [{ name: '@synthetic' }],
      },
      {
        file: 'apps/backend/package.json',
        dependencies: [{ name: 'unused-runtime' }],
        devDependencies: [{ name: 'unused-dev' }],
        optionalPeerDependencies: [],
      },
      {
        file: 'apps/backend/src/example.ts',
        exports: [{ name: 'one' }, { name: 'two' }],
        types: [{ name: 'Shape' }],
        unlisted: [{ name: 'missing' }],
      },
      {
        file: 'apps/frontend/package.json',
        binaries: [{ name: 'missing-bin' }],
      },
      {
        file: 'apps/frontend/src/unused.ts',
        files: [{ name: 'apps/frontend/src/unused.ts' }],
      },
    ],
  };
  assert.deepEqual(
    countKnipReport(report),
    counts(
      {
        exports: 2,
        types: 1,
        dependencies: 1,
        devDependencies: 1,
        unlisted: 1,
      },
      { files: 1, binaries: 1 },
      { files: 1 },
    ),
  );
  assert.deepEqual(countKnipReport({ issues: [] }), counts());
});

test('invalid reports and findings outside the approved categories fail rather than disappear', () => {
  for (const report of [
    { files: [], issues: [] },
    {},
    { issues: {} },
    { issues: [{ file: '../outside.ts', files: [{ name: 'outside' }] }] },
    {
      issues: [{ file: 'apps/other/example.ts', exports: [{ name: 'value' }] }],
    },
    { issues: [{ file: '/absolute.ts', types: [] }] },
    { issues: [{ file: 'example.ts', exports: 'bad' }] },
    { issues: [{ file: 'example.ts', exports: [{}] }] },
    { issues: [{ file: 'example.ts', unknown: [] }] },
    { issues: [{ file: 'example.ts' }, { file: 'example.ts' }] },
  ])
    assert.throws(() => countKnipReport(report), /report-schema/);
  assert.throws(
    () =>
      countKnipReport({
        issues: [
          {
            file: 'package.json',
            optionalPeerDependencies: [{ name: 'peer' }],
          },
        ],
      }),
    /unsupported-issue-type/,
  );
});

test('CLI honors report-mode exit status, pinned version and summary output', (t) => {
  const repo = fixture(t);
  const base = repo.commit();
  repo.checkers();
  repo.write('.gitignore', 'node_modules/\nsummary.txt\n');
  repo.write('knip.json', '{}\n');
  repo.write(
    'node_modules/knip/package.json',
    '{"version":"6.40.0","type":"module","exports":"./dist/index.js"}\n',
  );
  repo.write('node_modules/knip/dist/index.js', 'export {};\n');
  repo.write(
    'node_modules/knip/bin/knip.js',
    `import fs from 'node:fs';
import assert from 'node:assert/strict';
assert.deepEqual(process.argv.slice(2), ['--config', 'knip.json', '--reporter', 'json', '--no-progress', '--include', 'files,exports,types,dependencies,devDependencies,unlisted,binaries']);
const response = JSON.parse(fs.readFileSync('response.json', 'utf8'));
process.stdout.write(JSON.stringify(response.report));
process.exitCode = response.status;
`,
  );
  const response = (report, status) =>
    repo.write('response.json', JSON.stringify({ report, status }));
  const report = {
    issues: [
      { file: 'apps/backend/src/example.ts', exports: [{ name: 'unused' }] },
    ],
  };
  response(report, 1);
  repo.commit();
  const invoke = (...args) =>
    spawnSync(
      process.execPath,
      [
        CHECKER,
        '--event',
        'push',
        '--base-sha',
        base,
        '--head-sha',
        repo.git('rev-parse', 'HEAD'),
        ...args,
      ],
      {
        cwd: repo.root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_STEP_SUMMARY: path.join(repo.root, 'summary.txt'),
        },
      },
    );
  const seeded = invoke('--seed');
  assert.equal(seeded.status, 0, seeded.stderr);
  assert.match(seeded.stdout, /Knip ratchet: seed; Knip 6\.40\.0/);
  assert.match(
    fs.readFileSync(path.join(repo.root, 'summary.txt'), 'utf8'),
    /apps\/backend \| exports \| 1/,
  );
  assert.equal(invoke().status, 0);
  response(report, 2);
  assert.match(invoke().stderr, /knip-execution/);
  response({ issues: [] }, 1);
  assert.match(invoke().stderr, /knip-execution/);
  response(report, 0);
  repo.write(
    'node_modules/knip/package.json',
    '{"version":"6.41.0","type":"module","exports":"./dist/index.js"}\n',
  );
  assert.match(invoke().stderr, /knip-version/);
});

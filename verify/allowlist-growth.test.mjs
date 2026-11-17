import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAllowlistGrowth } from './allowlist-growth.mjs';
import { resolveRanges } from './scope.mjs';
import { eventFile, tempRepo } from './test-support.mjs';

const QUERY = 'verify/query-lint-allowlist.json';
const LOOP = 'apps/backend/eslint-rules/no-await-in-loop.allowlist.mjs';
const URL_IA = 'verify/url-ia-allowlist.json';
const THRESHOLDS = 'verify/thresholds.json';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const loop = (methods) =>
  `export const awaitInLoopAllowlist = ${JSON.stringify({ 'src/a.ts': methods })};\n`;
const thresholds = (lcp, performance) =>
  json({
    lighthouse: {
      goals: [
        { id: 'lcp', max: lcp },
        { id: 'performance', min: performance },
      ],
    },
    loginStart: { maxHopMs: 800, maxHops: 3 },
  });

function setup(t) {
  const repo = tempRepo(t);
  const base = repo.commit('base', {
    [QUERY]: json({ 'A.findMany@src/a.ts#f': { reason: 'r', count: 2 } }),
    [LOOP]: loop({ 'A.run': 'r' }),
    [URL_IA]: json({ entries: [] }),
    [THRESHOLDS]: thresholds(2500, 0.9),
  });
  return { repo, base };
}

const rules = (findings) => findings.map((item) => item.rule);

async function check(repo, base, head) {
  return checkAllowlistGrowth({
    cwd: repo.dir,
    ranges: [{ base, head, ref: 'HEAD' }],
  });
}

test('a new query-lint key without a trailer fails, with the trailer it passes', async (t) => {
  const { repo, base } = setup(t);
  const grown = {
    'A.findMany@src/a.ts#f': { reason: 'r', count: 2 },
    'B.findMany@src/b.ts#g': { reason: 'r' },
  };
  const bare = repo.commit('chore: grow', { [QUERY]: json(grown) });
  const findings = await check(repo, base, bare);
  assert.deepEqual(rules(findings), ['allowlist-growth']);
  assert.match(findings[0].message, /query-lint-allowlist\.json/);
  assert.match(findings[0].message, /B\.findMany@src\/b\.ts#g/);

  repo.git('reset', '-q', '--hard', base);
  const approved = repo.commit('chore: grow\n\nAllowlist-Approved: #1907', {
    [QUERY]: json(grown),
  });
  assert.deepEqual(await check(repo, base, approved), []);
});

test('a trailer without an issue number is rejected', async (t) => {
  const { repo, base } = setup(t);
  const head = repo.commit('chore: grow\n\nAllowlist-Approved: yes', {
    [LOOP]: loop({ 'A.run': 'r', 'A.walk': 'r' }),
  });
  const findings = await check(repo, base, head);
  assert.deepEqual(rules(findings), ['allowlist-growth']);
  assert.match(findings[0].message, /src\/a\.ts#A\.walk/);
});

test('a higher count fails; removal and unchanged lists pass', async (t) => {
  const { repo, base } = setup(t);
  const raised = repo.commit('raise', {
    [QUERY]: json({ 'A.findMany@src/a.ts#f': { reason: 'r', count: 3 } }),
  });
  const findings = await check(repo, base, raised);
  assert.deepEqual(rules(findings), ['allowlist-growth']);
  assert.match(findings[0].message, /count 2 -> 3/);

  repo.git('reset', '-q', '--hard', base);
  const shrunk = repo.commit('shrink', {
    [QUERY]: json({}),
    [LOOP]: loop({}),
    [THRESHOLDS]: thresholds(2000, 0.95),
  });
  assert.deepEqual(await check(repo, base, shrunk), []);
});

test('a new url-ia entry and a loosened threshold fail', async (t) => {
  const { repo, base } = setup(t);
  const head = repo.commit('loosen', {
    [URL_IA]: json({ entries: [{ rule: 'r', url: '/x', reason: 'y' }] }),
    [THRESHOLDS]: thresholds(3000, 0.8),
  });
  const findings = await check(repo, base, head);
  assert.equal(findings.length, 2);
  const text = findings.map((item) => item.message).join('\n');
  assert.match(text, /r \/x/);
  assert.match(text, /lighthouse\.lcp\.max 2500 -> 3000/);
  assert.match(text, /lighthouse\.performance\.min 0\.9 -> 0\.8/);
});

test('a guarded file missing at the trusted base fails closed', async (t) => {
  const repo = tempRepo(t);
  const base = repo.commit('base', { 'README.md': 'x\n' });
  const head = repo.commit('add', { [URL_IA]: json({ entries: [] }) });
  await assert.rejects(check(repo, base, head), /trusted base/);
});

test('pre-push, pull_request and push inputs all see the trailer', async (t) => {
  const { repo, base } = setup(t);
  repo.markRemoteMain(base);
  const grown = json({
    'A.findMany@src/a.ts#f': { reason: 'r', count: 2 },
    'C.findMany@src/c.ts#h': { reason: 'r' },
  });
  const bare = repo.commit('grow', { [QUERY]: grown });
  repo.git('reset', '-q', '--hard', base);
  const approved = repo.commit('grow\n\nAllowlist-Approved: #42', {
    [QUERY]: grown,
  });
  const inputs = (head) => [
    {
      cwd: repo.dir,
      source: 'pre-push',
      stdin: `refs/heads/x ${head} refs/heads/x ${base}\n`,
    },
    {
      cwd: repo.dir,
      source: 'ci',
      env: {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_SHA: head,
        GITHUB_EVENT_PATH: eventFile(t, {
          pull_request: { base: { sha: base } },
        }),
      },
    },
    {
      cwd: repo.dir,
      source: 'ci',
      env: {
        GITHUB_EVENT_NAME: 'push',
        GITHUB_SHA: head,
        GITHUB_EVENT_PATH: eventFile(t, { before: base }),
      },
    },
  ];
  for (const [head, expected] of [
    [bare, ['allowlist-growth']],
    [approved, []],
  ]) {
    for (const options of inputs(head)) {
      const ranges = await resolveRanges(options);
      const findings = await checkAllowlistGrowth({ cwd: repo.dir, ranges });
      assert.deepEqual(rules(findings), expected, options.source);
    }
  }
});

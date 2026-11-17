import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  checkFull,
  evaluateHops,
  evaluateLighthouse,
  evaluateNotFound,
  readThresholds,
} from './full.mjs';

const thresholds = readThresholds();
const lighthouse = thresholds.lighthouse;

const report = ({ lcp, cls, score }) => ({
  json: {
    audits: {
      'largest-contentful-paint': { numericValue: lcp },
      'cumulative-layout-shift': { numericValue: cls },
    },
    categories: { performance: { score } },
  },
});

test('the 3-run median decides a goal, and a miss names value, threshold and source', () => {
  const passing = evaluateLighthouse(
    'https://site/',
    [
      report({ lcp: 9000, cls: 0.01, score: 0.95 }),
      report({ lcp: 2100, cls: 0.02, score: 0.72 }),
      report({ lcp: 2400, cls: 0.5, score: 0.94 }),
    ],
    lighthouse,
  );
  assert.deepEqual(passing.findings, []);
  assert.equal(passing.measurements.lcp.median, 2400);

  const missing = evaluateLighthouse(
    'https://site/',
    [
      report({ lcp: 2600, cls: 0.2, score: 0.8 }),
      report({ lcp: 2700, cls: 0.2, score: 0.85 }),
      report({ lcp: 2400, cls: 0.05, score: 0.95 }),
    ],
    lighthouse,
  );
  assert.deepEqual(
    missing.findings.map((item) => [item.rule, item.measured, item.threshold]),
    [
      ['cwv-lcp', '2600', '<= 2500'],
      ['cwv-cls', '0.2', '<= 0.1'],
      ['cwv-performance', '0.85', '>= 0.9'],
    ],
  );
  assert.match(missing.findings[0].source, /web\.dev/);
});

test('a failed or incomplete Lighthouse run never yields a passing median', () => {
  const failed = evaluateLighthouse(
    'https://site/',
    [
      report({ lcp: 1000, cls: 0, score: 1 }),
      { error: 'timed out after 180000ms' },
      report({ lcp: 1000, cls: 0, score: 1 }),
    ],
    lighthouse,
  );
  assert.deepEqual(
    failed.findings.map((item) => item.rule),
    ['cwv-run-failed'],
  );
  const empty = evaluateLighthouse(
    'https://site/',
    [{ json: {} }, { json: {} }, { json: {} }],
    lighthouse,
  );
  assert.equal(empty.findings.length, lighthouse.goals.length);
});

test('login start must redirect to the provider quickly', () => {
  const config = thresholds.loginStart;
  const ok = [
    {
      url: 'https://site/api/v1/auth/github',
      status: 302,
      ms: 120,
      location: 'https://github.com/login/oauth/authorize',
    },
  ];
  assert.deepEqual(evaluateHops(ok, config), []);
  const slow = [{ ...ok[0], ms: 1500 }];
  assert.deepEqual(
    evaluateHops(slow, config).map((item) => [item.rule, item.measured]),
    [['login-start-hop', '1500ms']],
  );
  const broken = [
    {
      url: 'https://site/api/v1/auth/github',
      status: 500,
      ms: 50,
      location: null,
    },
  ];
  assert.deepEqual(
    evaluateHops(broken, config).map((item) => item.rule),
    ['login-start-redirect'],
  );
});

test('missing pages must answer 404', () => {
  const findings = evaluateNotFound(
    [
      { url: 'https://site/a', status: 404 },
      { url: 'https://site/b', status: 200 },
    ],
    thresholds.notFound,
  );
  assert.deepEqual(
    findings.map((item) => [item.rule, item.measured]),
    [['not-found-status', '200']],
  );
});

test('verify:full writes a report and fails on missed goals without real network access', async (t) => {
  const reportDir = mkdtempSync(join(tmpdir(), 'verify-full-'));
  t.after(() => rmSync(reportDir, { recursive: true, force: true }));
  const requested = [];
  const fetchImpl = async (url, init) => {
    requested.push([url, init.redirect, init.headers.cookie]);
    const login = url.endsWith('/api/v1/auth/github');
    return new Response(null, {
      status: login ? 302 : 200,
      headers: login
        ? { location: 'https://github.com/login/oauth/authorize?x=1' }
        : {},
    });
  };
  const findings = await checkFull({
    thresholds,
    reportDir,
    runLighthouse: async (url, outFile) => {
      writeFileSync(outFile, '{}');
      return report({ lcp: 3000, cls: 0, score: 0.95 });
    },
    fetchImpl,
    log: () => {},
  });
  assert.deepEqual([...new Set(findings.map((item) => item.rule))].sort(), [
    'cwv-lcp',
    'not-found-status',
  ]);
  assert.ok(
    requested.every(
      ([url, redirect, cookie]) =>
        url.startsWith('https://jnu-oss-hub.com/') &&
        redirect === 'manual' &&
        cookie === undefined,
    ),
  );
  const written = readdirSync(reportDir).find((name) =>
    name.startsWith('full-'),
  );
  const saved = JSON.parse(readFileSync(join(reportDir, written), 'utf8'));
  assert.equal(saved.findings.length, findings.length);
});

test('an http origin is rejected', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-thresholds-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'thresholds.json');
  writeFileSync(
    path,
    JSON.stringify({ ...thresholds, origin: 'http://jnu-oss-hub.com' }),
  );
  assert.throws(() => readThresholds(path), /must use https/);
});

test('a missing, invalid or incomplete thresholds file fails loudly', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-thresholds-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'thresholds.json');
  assert.throws(() => readThresholds(path), /cannot read thresholds/);
  writeFileSync(path, '{not json');
  assert.throws(() => readThresholds(path), /cannot read thresholds/);
  writeFileSync(path, JSON.stringify({ origin: thresholds.origin }));
  assert.throws(() => readThresholds(path), /is missing requestTimeoutMs/);
});

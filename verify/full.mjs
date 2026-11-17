import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LIGHTHOUSE_PACKAGE,
  REPO_ROOT,
  VerifyError,
  finding,
  run,
} from './tools.mjs';

const MAC_CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const USER_AGENT = 'oss-hub-verify-full (anonymous GET)';

export function readThresholds(
  path = join(REPO_ROOT, 'verify/thresholds.json'),
) {
  const thresholds = JSON.parse(readFileSync(path, 'utf8'));
  const origin = new URL(thresholds.origin);
  if (origin.protocol !== 'https:') {
    throw new VerifyError(
      `thresholds origin must use https, got ${origin.href}`,
    );
  }
  return thresholds;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function goalValue(report, goal) {
  const value = goal.audit
    ? report?.audits?.[goal.audit]?.numericValue
    : report?.categories?.[goal.category]?.score;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function evaluateLighthouse(url, reports, config) {
  const findings = [];
  const measurements = {};
  const failed = reports.filter((report) => report.error);
  if (failed.length > 0 || reports.length !== config.runs) {
    findings.push(
      finding(
        'cwv-run-failed',
        `${url}: ${failed.map((report) => report.error).join('; ') || 'missing runs'}`,
        `${reports.length - failed.length}/${config.runs} successful runs`,
        `${config.runs}/${config.runs} successful runs (no median from partial data)`,
        'https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md',
      ),
    );
    return { findings, measurements };
  }
  for (const goal of config.goals) {
    const values = reports.map((report) => goalValue(report.json, goal));
    if (values.some((value) => value === null)) {
      findings.push(
        finding(
          `cwv-${goal.id}`,
          `${url}: ${goal.label} missing from a Lighthouse report`,
          'missing',
          goal.max !== undefined ? `<= ${goal.max}` : `>= ${goal.min}`,
          goal.source,
        ),
      );
      continue;
    }
    const value = median(values);
    measurements[goal.id] = { median: value, runs: values };
    const missed =
      (goal.max !== undefined && value > goal.max) ||
      (goal.min !== undefined && value < goal.min);
    if (missed) {
      findings.push(
        finding(
          `cwv-${goal.id}`,
          `${url}: ${goal.label} misses the goal (runs: ${values.join(', ')})`,
          String(value),
          goal.max !== undefined ? `<= ${goal.max}` : `>= ${goal.min}`,
          goal.source,
        ),
      );
    }
  }
  return { findings, measurements };
}

async function lighthouseRun(url, outFile, config) {
  const profile = mkdtempSync(join(tmpdir(), 'verify-lh-profile-'));
  try {
    const env = {};
    if (!process.env.CHROME_PATH && existsSync(MAC_CHROME)) {
      env.CHROME_PATH = MAC_CHROME;
    }
    const result = await run(
      'npx',
      [
        '-y',
        LIGHTHOUSE_PACKAGE,
        url,
        '--output=json',
        `--output-path=${outFile}`,
        `--chrome-flags=--headless=new --user-data-dir=${profile}`,
        '--only-categories=performance',
        `--form-factor=${config.formFactor}`,
        '--quiet',
      ],
      { env, timeoutMs: config.deadlineSeconds * 1000 },
    );
    if (result.code !== 0) {
      return {
        error: `lighthouse exit ${result.code}: ${result.stderr.trim().slice(-300)}`,
      };
    }
    return { json: JSON.parse(readFileSync(outFile, 'utf8')) };
  } catch (error) {
    return { error: error.message };
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

export function evaluateHops(hops, config) {
  const findings = [];
  const slow = hops.filter((hop) => hop.ms > config.maxHopMs);
  for (const hop of slow) {
    findings.push(
      finding(
        'login-start-hop',
        `login start hop ${hop.url} -> ${hop.status} is slow`,
        `${Math.round(hop.ms)}ms`,
        `<= ${config.maxHopMs}ms per hop`,
        config.source,
      ),
    );
  }
  const last = hops.at(-1);
  const reachedProvider =
    last?.location &&
    new URL(last.location).hostname.endsWith(config.stopAtHost);
  if (!reachedProvider || hops.length > config.maxHops) {
    findings.push(
      finding(
        'login-start-redirect',
        `login start did not redirect to ${config.stopAtHost} within ${config.maxHops} hops: ${hops.map((hop) => `${hop.status} ${hop.url}`).join(' -> ')}`,
        `${hops.length} hop(s), last status ${last?.status ?? 'none'}`,
        `redirect to ${config.stopAtHost} in <= ${config.maxHops} hops`,
        config.source,
      ),
    );
  }
  return findings;
}

async function timedGet(url, fetchImpl, timeoutMs) {
  const started = performance.now();
  const response = await fetchImpl(url, {
    redirect: 'manual',
    cache: 'no-store',
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const ms = performance.now() - started;
  await response.body?.cancel();
  return {
    url,
    status: response.status,
    ms,
    location: response.headers.get('location'),
  };
}

async function loginHops(origin, config, fetchImpl, timeoutMs) {
  const hops = [];
  let url = new URL(config.path, origin).href;
  while (hops.length < config.maxHops + 1) {
    const hop = await timedGet(url, fetchImpl, timeoutMs);
    hops.push(hop);
    if (!hop.location || hop.status < 300 || hop.status >= 400) break;
    const next = new URL(hop.location, url);
    hop.location = next.href;
    if (next.hostname.endsWith(config.stopAtHost)) break;
    if (next.protocol !== 'https:') break;
    url = next.href;
  }
  return hops;
}

export function evaluateNotFound(results, config) {
  return results
    .filter((result) => result.status !== config.expectStatus)
    .map((result) =>
      finding(
        'not-found-status',
        `${result.url} should return ${config.expectStatus}`,
        String(result.status),
        String(config.expectStatus),
        config.source,
      ),
    );
}

export async function checkFull({
  thresholds = readThresholds(),
  reportDir = join(REPO_ROOT, 'verify/reports'),
  runLighthouse = lighthouseRun,
  fetchImpl = fetch,
  log = console.log,
}) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new VerifyError(
      'NODE_TLS_REJECT_UNAUTHORIZED=0 is set; verify:full requires TLS verification',
    );
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rawDir = join(reportDir, `lighthouse-${stamp}`);
  mkdirSync(rawDir, { recursive: true });
  const timeoutMs = thresholds.requestTimeoutMs;
  const report = {
    origin: thresholds.origin,
    at: stamp,
    pages: {},
    loginStart: null,
    notFound: [],
  };
  const findings = [];

  for (const path of thresholds.lighthouse.pages) {
    const url = new URL(path, thresholds.origin).href;
    const reports = [];
    for (let index = 1; index <= thresholds.lighthouse.runs; index += 1) {
      const slug =
        path === '/'
          ? 'home'
          : path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
      const outFile = join(rawDir, `${slug}-${index}.json`);
      log(
        `verify:full lighthouse ${url} run ${index}/${thresholds.lighthouse.runs}`,
      );
      reports.push(await runLighthouse(url, outFile, thresholds.lighthouse));
    }
    const result = evaluateLighthouse(url, reports, thresholds.lighthouse);
    report.pages[url] = result.measurements;
    findings.push(...result.findings);
  }

  try {
    const hops = await loginHops(
      thresholds.origin,
      thresholds.loginStart,
      fetchImpl,
      timeoutMs,
    );
    report.loginStart = hops.map(({ url, status, ms }) => ({
      url: new URL(url).pathname,
      status,
      ms: Math.round(ms),
    }));
    findings.push(...evaluateHops(hops, thresholds.loginStart));
  } catch (error) {
    findings.push(
      finding(
        'login-start-redirect',
        `login start request failed: ${error.message}`,
        'request error',
        'redirect response',
        thresholds.loginStart.source,
      ),
    );
  }

  const notFound = [];
  for (const path of thresholds.notFound.paths) {
    const url = new URL(path, thresholds.origin).href;
    try {
      notFound.push(await timedGet(url, fetchImpl, timeoutMs));
    } catch (error) {
      notFound.push({ url, status: `error: ${error.message}` });
    }
  }
  report.notFound = notFound.map(({ url, status }) => ({ url, status }));
  findings.push(...evaluateNotFound(notFound, thresholds.notFound));

  report.findings = findings;
  const reportFile = join(reportDir, `full-${stamp}.json`);
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  log(`verify:full report: ${reportFile}`);
  return findings;
}

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_BRANCH = 'origin/main';
export const API_BASELINE_PATH = 'verify/openapi.baseline.json';
export const API_GLOBAL_PREFIX = '/api/v1';
export const OPENAPI_DUMP_COMMAND = [
  'pnpm',
  '--filter',
  'backend',
  'openapi:dump',
  '--',
  '--out',
  '{out}',
];
export const LIGHTHOUSE_PACKAGE = 'lighthouse@12.8.2';
export const SPECTRAL_PACKAGE = '@stoplight/spectral-cli@6.17.1';
export const REDOCLY_PACKAGE = '@redocly/cli@2.79.0';

const VERIFY_ISSUE = 'https://github.com/JNU-SWCU/oss-hub/issues/1907';
const URL_RULES_ISSUE = 'https://github.com/JNU-SWCU/oss-hub/issues/1859';
const QUERY_ISSUE = 'https://github.com/JNU-SWCU/oss-hub/issues/1909';

export const RULE_SOURCES = {
  'secrets-gitleaks': 'https://github.com/gitleaks/gitleaks',
  'public-safe':
    'https://github.com/JNU-SWCU/oss-hub/blob/main/.github/check-public-safe.sh',
  'api-breaking':
    'https://github.com/oasdiff/oasdiff/blob/main/docs/BREAKING-CHANGES.md',
  'api-baseline-stale': VERIFY_ISSUE,
  'api-break-unapproved': VERIFY_ISSUE,
  'api-route-reconciliation': VERIFY_ISSUE,
  'api-route-unresolved': VERIFY_ISSUE,
  'url-ia-unreachable-page':
    'https://developers.google.com/search/docs/crawling-indexing/links-crawlable',
  'url-ia-duplicate-screen':
    'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
  'url-ia-allowlist-stale': URL_RULES_ISSUE,
  'query-lint': QUERY_ISSUE,
  'query-growth': QUERY_ISSUE,
  'cwv-run-failed':
    'https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md',
};

export const GITLEAKS = {
  name: 'gitleaks',
  version: '8.30.1',
  bin: process.env.VERIFY_GITLEAKS_BIN ?? 'gitleaks',
  versionArgs: ['version'],
  install:
    'https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1 (same version as .github/workflows/ci.yml)',
};

export const OASDIFF = {
  name: 'oasdiff',
  version: '1.38.0',
  bin: process.env.VERIFY_OASDIFF_BIN ?? 'oasdiff',
  versionArgs: ['--version'],
  install:
    'https://github.com/oasdiff/oasdiff/releases/tag/v1.38.0 (or: go install github.com/oasdiff/oasdiff@v1.38.0)',
};

export class VerifyError extends Error {}

export function isZeroSha(sha) {
  return /^0+$/.test(sha);
}

export function finding(
  rule,
  message,
  measured,
  threshold,
  source = RULE_SOURCES[rule],
) {
  if (typeof source !== 'string' || !/^https:\/\/\S+$/.test(source)) {
    throw new Error(`rule ${rule} has no https source URL`);
  }
  return { rule, message, measured, threshold, source };
}

export function formatFinding(item, label = 'FAIL') {
  return [
    `${label} [${item.rule}] ${item.message}`,
    `  measured:  ${item.measured}`,
    `  threshold: ${item.threshold}`,
    `  source:    ${item.source}`,
  ].join('\n');
}

const liveGroups = new Set();
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };
let interruptedBy;

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      return;
    }
  }
}

function forwardSignal(signal) {
  interruptedBy = signal;
  for (const pid of liveGroups) signalGroup(pid, signal);
  if (liveGroups.size === 0) process.exit(SIGNAL_EXIT_CODES[signal]);
}

function trackGroup(pid) {
  if (liveGroups.size === 0) {
    for (const signal of Object.keys(SIGNAL_EXIT_CODES))
      process.on(signal, forwardSignal);
  }
  liveGroups.add(pid);
}

function releaseGroup(pid) {
  liveGroups.delete(pid);
  if (liveGroups.size > 0) return;
  for (const signal of Object.keys(SIGNAL_EXIT_CODES))
    process.off(signal, forwardSignal);
  if (interruptedBy) process.exit(SIGNAL_EXIT_CODES[interruptedBy]);
}

export function run(
  command,
  args,
  {
    cwd = REPO_ROOT,
    input,
    timeoutMs = 120_000,
    killGraceMs = 10_000,
    env,
    raw = false,
  } = {},
) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (child.pid !== undefined) trackGroup(child.pid);
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      signalGroup(child.pid, 'SIGTERM');
      killTimer = setTimeout(
        () => signalGroup(child.pid, 'SIGKILL'),
        killGraceMs,
      );
    }, timeoutMs);
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (child.pid !== undefined) releaseGroup(child.pid);
      reject(
        new VerifyError(
          error.code === 'ENOENT'
            ? `command not found: ${command}`
            : `${command} failed to start: ${error.message}`,
        ),
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      releaseGroup(child.pid);
      if (timedOut) {
        reject(
          new VerifyError(
            `${command} ${args.join(' ')} timed out after ${timeoutMs}ms and was stopped`,
          ),
        );
        return;
      }
      const out = Buffer.concat(stdout);
      resolvePromise({
        code,
        stdout: raw ? out : out.toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

export async function git(cwd, args, options = {}) {
  const result = await run('git', args, { cwd, ...options });
  if (result.code !== 0) {
    throw new VerifyError(
      `git ${args.join(' ')} failed: ${result.stderr.trim()}`,
    );
  }
  return options.raw ? result.stdout : result.stdout.trim();
}

export async function gitOk(cwd, args) {
  const result = await run('git', args, { cwd });
  return result.code === 0 ? result.stdout.trim() : null;
}

export async function showAtRevision(cwd, revision, path) {
  const result = await run('git', ['show', `${revision}:${path}`], { cwd });
  return result.code === 0 ? result.stdout : null;
}

export async function requireTool(tool) {
  let result;
  try {
    result = await run(tool.bin, tool.versionArgs, { timeoutMs: 15_000 });
  } catch (error) {
    throw new VerifyError(
      `${tool.name} ${tool.version} is required but could not run (${error.message}). Install it: ${tool.install}`,
    );
  }
  const versionPattern = new RegExp(
    `(^|[^0-9.])v?${tool.version.replaceAll('.', '\\.')}($|[^0-9.])`,
  );
  if (result.code !== 0 || !versionPattern.test(result.stdout)) {
    throw new VerifyError(
      `${tool.name} ${tool.version} is required, found: ${(result.stdout || result.stderr).trim() || 'no version output'}. Install it: ${tool.install}`,
    );
  }
}

export function isEntry(moduleUrl) {
  return (
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(moduleUrl)
  );
}

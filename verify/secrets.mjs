import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GITLEAKS,
  VerifyError,
  finding,
  git,
  requireTool,
  run,
} from './tools.mjs';

async function scanRange(cwd, range, tool) {
  const reportDir = mkdtempSync(join(tmpdir(), 'verify-gitleaks-'));
  const reportPath = join(reportDir, 'report.json');
  try {
    const result = await run(
      tool.bin,
      [
        'git',
        '--no-banner',
        '--redact',
        '--exit-code',
        '1',
        '--report-format',
        'json',
        '--report-path',
        reportPath,
        `--log-opts=${range.base}..${range.head}`,
        '.',
      ],
      { cwd, timeoutMs: 300_000 },
    );
    if (result.code === 0) return [];
    if (result.code !== 1) {
      throw new VerifyError(
        `gitleaks failed (exit ${result.code}): ${result.stderr.trim()}`,
      );
    }
    const leaks = JSON.parse(readFileSync(reportPath, 'utf8'));
    const where = leaks
      .map(
        (leak) =>
          `${leak.RuleID} ${leak.File}:${leak.StartLine} @${String(leak.Commit).slice(0, 9)}`,
      )
      .join('; ');
    return [
      finding(
        'secrets-gitleaks',
        `secrets found in ${range.base.slice(0, 9)}..${range.head.slice(0, 9)}: ${where}`,
        `${leaks.length} leak(s)`,
        '0 leaks',
      ),
    ];
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
}

async function publicSafe(cwd, range) {
  const result = await run(
    'bash',
    ['.github/check-public-safe.sh', range.base],
    {
      cwd,
      timeoutMs: 120_000,
    },
  );
  if (result.code === 0) return [];
  if (result.code !== 1) {
    throw new VerifyError(
      `public-safe could not run (exit ${result.code}): ${(result.stdout + result.stderr).trim()}`,
    );
  }
  return [
    finding(
      'public-safe',
      `deny-list match in ${range.base.slice(0, 9)}...HEAD:\n${result.stdout.trim()}`,
      'deny-list match',
      '0 matches',
    ),
  ];
}

export async function checkSecrets({ cwd, ranges, tool = GITLEAKS }) {
  await requireTool(tool);
  const head = await git(cwd, ['rev-parse', 'HEAD']);
  const findings = [];
  for (const range of ranges) {
    if (range.base === range.head) continue;
    findings.push(...(await scanRange(cwd, range, tool)));
    if (range.head !== head) {
      throw new VerifyError(
        `public-safe scans the checked-out HEAD, but ${range.ref} is ${range.head.slice(0, 9)}; check out the branch you push`,
      );
    }
    findings.push(...(await publicSafe(cwd, range)));
  }
  return findings;
}

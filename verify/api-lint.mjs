import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REDOCLY_PACKAGE, REPO_ROOT, SPECTRAL_PACKAGE, run } from './tools.mjs';

const SPECTRAL_RULESET = join(REPO_ROOT, 'verify/.spectral.yaml');
const LINT_TIMEOUT_MS = 300_000;

function count(name, report) {
  if (name === 'spectral') return `${report.length} finding(s)`;
  return `${report.totals?.errors ?? 0} error(s), ${report.totals?.warnings ?? 0} warning(s)`;
}

export async function writeApiLintReports(
  specFile,
  {
    reportDir = join(REPO_ROOT, 'verify/reports'),
    log = console.log,
    runner = run,
  } = {},
) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(reportDir, { recursive: true });
  const tools = [
    {
      name: 'spectral',
      output: join(reportDir, `api-spectral-${stamp}.json`),
      args: (output) => [
        '-y',
        SPECTRAL_PACKAGE,
        'lint',
        specFile,
        '--ruleset',
        SPECTRAL_RULESET,
        '--format',
        'json',
        '--output',
        output,
      ],
    },
    {
      name: 'redocly',
      output: join(reportDir, `api-redocly-${stamp}.json`),
      args: () => [
        '-y',
        REDOCLY_PACKAGE,
        'lint',
        specFile,
        '--extends',
        'recommended',
        '--format',
        'json',
        '--max-problems',
        '10000',
      ],
      fromStdout: true,
    },
  ];
  for (const tool of tools) {
    try {
      const result = await runner('npx', tool.args(tool.output), {
        cwd: reportDir,
        timeoutMs: LINT_TIMEOUT_MS,
      });
      if (tool.fromStdout) writeFileSync(tool.output, result.stdout);
      if (!existsSync(tool.output)) {
        throw new Error(
          `no report written (exit ${result.code}): ${result.stderr.trim().slice(-200)}`,
        );
      }
      const report = JSON.parse(readFileSync(tool.output, 'utf8'));
      log(
        `api-lint: ${tool.name} ${count(tool.name, report)} -> ${tool.output} (report only, does not affect the exit code)`,
      );
    } catch (error) {
      log(
        `api-lint: ${tool.name} report skipped (${error.message}); report only, the exit code is unaffected`,
      );
    }
  }
}

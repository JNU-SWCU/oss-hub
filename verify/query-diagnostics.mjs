import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const name = (value) =>
  [
    ...stripVTControlCharacters(value).replace(
      /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g,
      '',
    ),
  ]
    .slice(0, 200)
    .join('');

export function queryDiagnostics(
  { stdout, stderr },
  { report, cwd = process.cwd(), directory } = {},
) {
  const summary = [];
  for (const suite of Array.isArray(report?.testResults)
    ? report.testResults
    : []) {
    if (suite?.status !== 'failed' || typeof suite.name !== 'string') continue;
    summary.push(`FAIL ${name(relative(cwd, resolve(cwd, suite.name)))}`);
    for (const test of Array.isArray(suite.assertionResults)
      ? suite.assertionResults
      : []) {
      if (test?.status === 'failed' && typeof test.fullName === 'string') {
        summary.push(`  ● ${name(test.fullName)}`);
      }
      if (summary.length >= 12) break;
    }
    if (summary.length >= 12) break;
  }
  const path = join(
    directory ?? mkdtempSync(join(tmpdir(), 'oss-hub-query-')),
    'integration.log',
  );
  writeFileSync(path, `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`, {
    mode: 0o600,
    flag: 'wx',
  });
  return { text: [...summary, `Full local log: ${path}`].join('\n') };
}

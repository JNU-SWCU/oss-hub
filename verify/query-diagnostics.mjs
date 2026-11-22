import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const name = (value) =>
  [...value.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, '')]
    .slice(0, 200)
    .join('');

export function queryDiagnostics({ stdout, stderr }, { jest = false } = {}) {
  const summary = [];
  let hasLint = false;
  for (const stream of [stderr, stdout]) {
    let failedSuite = false;
    for (const raw of stream.split('\n')) {
      const line = stripVTControlCharacters(raw);
      if (/^\s*\[LINT\.[A-Z_]{1,40}\]/.test(line)) hasLint = true;
      if (!jest || summary.length >= 12) continue;
      if (/^(?:PASS |FAIL |Test Suites:)/.test(line)) {
        const suite = /^FAIL\s+([\w./-]+\.integration\.spec\.ts)(?:\s|$)/.exec(
          line,
        );
        failedSuite = suite !== null;
        if (suite) summary.push(`FAIL ${name(suite[1])}`);
      } else if (
        failedSuite &&
        /^\s+● /.test(line) &&
        !/^\s+● Console\s*$/.test(line)
      ) {
        summary.push(`  ● ${name(line.replace(/^\s+● /, ''))}`);
      }
    }
  }
  const path = join(
    mkdtempSync(join(tmpdir(), 'oss-hub-query-')),
    'integration.log',
  );
  writeFileSync(path, `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`, {
    mode: 0o600,
    flag: 'wx',
  });
  return { hasLint, text: [...summary, `Full local log: ${path}`].join('\n') };
}

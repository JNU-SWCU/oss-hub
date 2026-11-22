import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

function safeLine(line) {
  const cleaned = line
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    .replace(/\b(Bearer|Basic)\s+[\w./+=~-]+/gi, '$1 [REDACTED]')
    .replace(
      /\b(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AIPA|ANPA|ANVA|AROA|A3T[A-Z0-9])[A-Z0-9]{16}\b/g,
      '[REDACTED]',
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
      '[REDACTED]',
    )
    .replace(
      /(\b[\w-]*(?:token|secret|password|authorization|api[-_]?key|cookie)[\w-]*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/]+@/gi, '[REDACTED]@')
    .replace(/[\w./+=~-]{24,}/g, (value) =>
      /^[\w/.-]+\.integration\.spec\.ts$/.test(value) ? value : '[REDACTED]',
    );
  return Buffer.byteLength(cleaned) > 200
    ? `${Buffer.from(cleaned).subarray(0, 200).toString('utf8')}…`
    : cleaned;
}

export function queryDiagnostics({ stdout, stderr }, { jest = false } = {}) {
  const summary = [];
  const lintIds = new Set();
  for (const stream of [stderr, stdout]) {
    let failedSuite = false;
    let failedTest = false;
    for (const raw of stream.split('\n')) {
      const line = stripVTControlCharacters(raw);
      const lintId = /^\s*(\[LINT\.[A-Z_]{1,40}\])/.exec(line);
      if (lintId) lintIds.add(lintId[1]);
      if (!jest || summary.length >= 12) continue;
      if (/^(?:PASS |FAIL |Test Suites:)/.test(line)) {
        failedSuite = /^FAIL\s+[\w./-]+\.integration\.spec\.ts(?:\s|$)/.test(
          line,
        );
        failedTest = false;
        if (failedSuite) summary.push(safeLine(line));
      } else if (failedSuite && /^\s+● /.test(line)) {
        failedTest = !/^\s+● Console\s*$/.test(line);
        if (failedTest) summary.push(safeLine(line));
      } else if (
        failedTest &&
        /^\s+(?:[-+]\s+)?(?:Expected|Received)(?:\s+\w+)*:/.test(line)
      ) {
        summary.push(safeLine(line));
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
  return {
    hasLint: lintIds.size > 0,
    text: [
      ...summary,
      ...[...lintIds].slice(0, 8),
      `Full local log: ${path}`,
    ].join('\n'),
  };
}

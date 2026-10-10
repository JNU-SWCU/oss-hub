#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const INCLUDE_ROOTS = ['apps/backend/src', 'apps/backend/prisma'];

const EXCLUDE_PATTERNS = [/\.spec\.ts$/, /\.test\.ts$/];

export function isScannedSource(path) {
  if (!path.endsWith('.ts')) {
    return false;
  }
  if (!INCLUDE_ROOTS.some((root) => path.startsWith(`${root}/`))) {
    return false;
  }
  return !EXCLUDE_PATTERNS.some((pattern) => pattern.test(path));
}

function selectScannedSources(paths) {
  return paths.filter(isScannedSource).sort();
}

function listTrackedSources(repositoryRoot) {
  const tracked = execFileSync(
    'git',
    ['ls-files', '--', ...INCLUDE_ROOTS.map((root) => `${root}/**/*.ts`)],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  return selectScannedSources(
    tracked.split('\n').filter((line) => line.length > 0),
  );
}

export { EXCLUDE_PATTERNS };

function main() {
  const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const sources = listTrackedSources(repositoryRoot);
  if (sources.length === 0) {
    process.stderr.write(
      'contract source scan: no production sources matched — the include policy is broken\n',
    );
    process.exit(2);
  }
  process.stdout.write(`${sources.join('\n')}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

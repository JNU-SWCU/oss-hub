import { execFileSync } from 'node:child_process';
import {
  readdirSync,
  writeFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  cpSync,
  renameSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const repo = path.resolve(import.meta.dirname, '..');
const pkgDir = path.join(repo, 'apps/frontend');
const tsc = path.join(pkgDir, 'node_modules/.bin/tsc');
const tsconfig = path.join(repo, '.design-sync/tsconfig.dts.json');

const temporary = mkdtempSync(path.join(tmpdir(), 'design-types-'));
const typesDir = path.join(temporary, 'types');
let staged;
let previousMoved = false;
try {
  execFileSync(tsc, ['-p', tsconfig, '--declarationDir', typesDir], {
    stdio: 'inherit',
  });
  if (!existsSync(path.join(typesDir, 'components/index.d.ts'))) {
    throw new Error('Component declarations were not emitted');
  }

  const uiDir = path.join(typesDir, 'components/ui');
  const ui = existsSync(uiDir)
    ? readdirSync(uiDir)
        .filter((f) => f.endsWith('.d.ts'))
        .map((f) => f.replace(/\.d\.ts$/, ''))
        .sort()
    : [];

  const lines = [
    "export * from './ds-types/components';",
    ...ui.map((n) => `export * from './ds-types/components/ui/${n}';`),
    '',
  ].join('\n');

  const count = readdirSync(path.join(typesDir, 'components')).filter((f) =>
    f.endsWith('.d.ts'),
  ).length;
  staged = mkdtempSync(path.join(pkgDir, '.design-types-'));
  const publishedTypes = path.join(pkgDir, 'ds-types');
  const previousTypes = path.join(staged, 'previous');
  cpSync(typesDir, path.join(staged, 'ds-types'), { recursive: true });
  writeFileSync(path.join(staged, 'index.d.ts'), lines);
  let installed = false;
  try {
    if (existsSync(publishedTypes)) {
      renameSync(publishedTypes, previousTypes);
      previousMoved = true;
    }
    renameSync(path.join(staged, 'ds-types'), publishedTypes);
    installed = true;
    renameSync(
      path.join(staged, 'index.d.ts'),
      path.join(pkgDir, 'index.d.ts'),
    );
    previousMoved = false;
  } catch (error) {
    if (installed) rmSync(publishedTypes, { recursive: true, force: true });
    if (previousMoved) {
      renameSync(previousTypes, publishedTypes);
      previousMoved = false;
    }
    throw error;
  }
  console.error(
    `[TYPES] ${count} component + ${ui.length} ui 선언 → ds-types/, index.d.ts 생성`,
  );
} catch (error) {
  console.error('[TYPES] declaration emission failed:', error.message);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
  if (previousMoved) {
    console.error(
      '[TYPES] previous declarations retained at:',
      path.join(staged, 'previous'),
    );
  } else if (staged) {
    rmSync(staged, { recursive: true, force: true });
  }
}

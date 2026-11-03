import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(__dirname, '../../../..');
const existing = 'apps/backend/package.json';
const missing = 'file-ledger-nonexistent-probe.ts';

it.each([
  { path: existing, action: 'keep', state: 'present', exit: 0 },
  { path: missing, action: 'delete', state: 'deleted', exit: 0 },
  { path: missing, action: 'merge', state: 'present', exit: 1 },
  { path: existing, action: 'delete', state: 'deleted', exit: 1 },
  { path: missing, action: 'keep', state: 'deleted', exit: 1 },
])('checks actual file state for $action $state $path', async (input) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'oss-hub-file-ledger-'));
  try {
    const ledger = resolve(directory, 'ledger.md');
    await writeFile(
      ledger,
      `| \`${input.path}\` | ${input.action} | - | 1 | ${input.state} | 0 |\n`,
    );
    let exit = 0;
    let stdout = '';
    try {
      ({ stdout } = await run('pnpm', ['run', 'check:file-ledger', ledger], {
        cwd: root,
        timeout: 10_000,
      }));
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        typeof error.code !== 'number'
      ) {
        throw error;
      }
      exit = error.code;
    }
    expect(exit).toBe(input.exit);
    if (input.exit === 0) expect(stdout).toContain('FILE_LEDGER_OK 1 paths');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

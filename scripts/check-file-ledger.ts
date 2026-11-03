import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ledger = resolve(
  root,
  process.argv[2] ??
    'docs/evidence/program-table-simplification/file-ledger.md',
);

async function main(): Promise<void> {
  const text = await readFile(ledger, 'utf8');
  const rows = text.split('\n').filter((line) => line.startsWith('| `'));
  if (rows.length === 0) throw new Error('File ledger has no file rows');
  const seen = new Set<string>();
  const failures: string[] = [];
  for (const row of rows) {
    const columns = row.split('|').map((column) => column.trim());
    const path = columns[1]?.replace(/^`|`$/g, '');
    const action = columns[2];
    const state = columns[5];
    if (
      !path ||
      !['delete', 'merge', 'keep'].includes(action ?? '') ||
      !['present', 'deleted'].includes(state ?? '')
    ) {
      failures.push(`Invalid file row: ${row}`);
      continue;
    }
    const absolute = resolve(root, path);
    const local = relative(root, absolute);
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) {
      failures.push(`Path outside repository: ${path}`);
      continue;
    }
    if (seen.has(path)) failures.push(`Duplicate path: ${path}`);
    seen.add(path);
    let exists = false;
    try {
      exists = (await stat(absolute)).isFile();
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      )) {
        throw error;
      }
    }
    if (state === 'deleted') {
      if (action === 'keep') failures.push(`Kept path marked deleted: ${path}`);
      if (exists) failures.push(`Deleted path still exists: ${path}`);
    } else if (!exists) {
      failures.push(`Missing ledger path: ${path}`);
    }
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
  console.info(`FILE_LEDGER_OK ${rows.length} paths`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

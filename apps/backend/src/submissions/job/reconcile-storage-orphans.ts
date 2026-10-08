import type { StorageOrphanReconciliationMode } from '../domain/storage-orphan-reconciliation';
import { runStorageOrphanReconciliation } from '../service/storage-orphan-reconciliation.runner';

export function parseStorageOrphanReconciliationMode(
  args: readonly string[],
): StorageOrphanReconciliationMode {
  if (args.length === 0 || (args.length === 1 && args[0] === '--report')) {
    return 'report';
  }
  if (args.length === 1 && args[0] === '--delete') return 'delete';
  throw new Error('Exactly one mode is allowed: --report or --delete');
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const mode = parseStorageOrphanReconciliationMode(args);
  await runStorageOrphanReconciliation(mode);
}

if (require.main === module) {
  void main().catch(() => {
    process.stderr.write('Storage orphan reconciliation failed\n');
    process.exitCode = 1;
  });
}

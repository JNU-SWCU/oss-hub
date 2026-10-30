import type { StorageOrphanReconciliationMode } from './storage-orphan-reconciliation.policy';
import { runStorageOrphanReconciliation } from './storage-orphan-reconciliation.service';

export function parseStorageOrphanReconciliationMode(
  args: readonly string[],
): StorageOrphanReconciliationMode {
  if (args.length === 0 || (args.length === 1 && args[0] === '--report')) {
    return 'report';
  }
  if (args.length === 1 && args[0] === '--delete') return 'delete';
  throw new Error('Exactly one mode is allowed: --report or --delete');
}

export class ReconcileStorageOrphansJob {
  async run(args = process.argv.slice(2)): Promise<void> {
    const mode = parseStorageOrphanReconciliationMode(args);
    await runStorageOrphanReconciliation(mode);
  }
}

if (require.main === module) {
  void new ReconcileStorageOrphansJob().run().catch(() => {
    process.stderr.write('Storage orphan reconciliation failed\n');
    process.exitCode = 1;
  });
}

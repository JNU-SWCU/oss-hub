import { PrismaClient } from '@prisma/client';
import { S3SubmissionFileStorage } from '../s3-submission-file.storage';
import { SubmissionFileStorageConfig } from '../submission-file-storage.config';
import {
  StorageOrphanReconciliationService,
  type StorageOrphanReconciliationMode,
} from '../storage-orphan-reconciliation';
import { PrismaStorageReferenceRepository } from '../storage-orphan-reconciliation.repository';

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
  const prisma = new PrismaClient();
  const storage = new S3SubmissionFileStorage(
    new SubmissionFileStorageConfig(),
  );
  const reconciliation = new StorageOrphanReconciliationService(
    new PrismaStorageReferenceRepository(prisma),
    storage,
  );

  try {
    const result = await reconciliation.reconcile({
      mode,
      onDeletePlan: (keys) => {
        process.stdout.write(
          `${JSON.stringify({ event: 'storage-orphan.delete-plan', keys })}\n`,
        );
      },
    });
    process.stdout.write(
      `${JSON.stringify({
        event: 'storage-orphan.result',
        mode: result.mode,
        runStartedAt: result.runStartedAt.toISOString(),
        cutoffAt: result.cutoffAt.toISOString(),
        orphanKeys: result.orphanKeys,
        recentObjectCount: result.recentObjectKeys.length,
        deletedKeys: result.deletedKeys,
        skippedReferencedKeys: result.skippedReferencedKeys,
      })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch(() => {
    process.stderr.write('Storage orphan reconciliation failed\n');
    process.exitCode = 1;
  });
}

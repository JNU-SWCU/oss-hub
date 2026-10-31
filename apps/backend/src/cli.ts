import {
  ConsoleLogger,
  Logger,
  type INestApplicationContext,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  INVALID_DIGEST_FORCE_TO_MESSAGE,
  InvalidDigestForceToError,
} from './notifications/deadline-digest-failure.error';
import {
  type ObjectInventoryPort,
  type ObjectStoragePort,
} from './platform/object-storage.types';
import {
  OBJECT_INVENTORY,
  OBJECT_STORAGE,
} from './platform/object-storage.config';
import type { StorageReferenceRepository } from './programs/prisma-storage-reference.repository';
import type {
  StorageObjectInventory,
  StorageOrphanReconciliationMode,
} from './programs/storage-orphan-reconciliation.service';
import { PROCESS_RUNTIME_CONFIG } from './platform/runtime-config-instance.config';
import { loadRuntimeConfig } from './platform/runtime-config.config';

const ENABLED_VALUE = '1';

export async function retrySubmissionFileCleanup(
  args: readonly string[],
): Promise<void> {
  const logger = new Logger('retry-submission-file-cleanup-cli');
  const runtime = loadRuntimeConfig(process.env);
  const fileId = args[0]?.trim();
  const operatorId = runtime.SUBMISSION_FILE_CLEANUP_OPERATOR_ID?.trim();

  if (runtime.SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED !== ENABLED_VALUE) {
    throw new Error('Submission file cleanup maintenance is disabled');
  }
  if (!operatorId || !fileId || args.length !== 1) {
    throw new Error(
      'Authorized operator and exactly one opaque file id are required',
    );
  }

  const { AppModule } = await import('./app.module');
  const { SubmissionFileCleanupRetryService } =
    await import('./programs/submission-file-cleanup.service');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    await app.get(SubmissionFileCleanupRetryService).retry(operatorId, fileId);
    logger.log({
      event: 'submission-file.cleanup.retry-reset',
      operatorRole: 'ADMIN',
    });
  } finally {
    await app.close();
  }
}

function parseStorageOrphanReconciliationMode(
  args: readonly string[],
): StorageOrphanReconciliationMode {
  if (args.length === 0 || (args.length === 1 && args[0] === '--report')) {
    return 'report';
  }
  if (args.length === 1 && args[0] === '--delete') return 'delete';
  throw new Error('Exactly one mode is allowed: --report or --delete');
}

async function runStorageOrphanReconciliation(
  mode: StorageOrphanReconciliationMode,
  references: StorageReferenceRepository,
  objectStorage: ObjectStoragePort,
  objectInventory: ObjectInventoryPort,
): Promise<void> {
  const { KNOWN_STORAGE_PREFIXES, StorageOrphanReconciliationService } =
    await import('./programs/storage-orphan-reconciliation.service');
  const inventory: StorageObjectInventory = {
    listObjects: () => objectInventory.listObjects(KNOWN_STORAGE_PREFIXES),
    delete: (key) => objectStorage.delete(key),
  };
  const reconciliation = new StorageOrphanReconciliationService(
    references,
    inventory,
  );

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
}

export async function reconcileStorageOrphans(
  args: readonly string[],
): Promise<void> {
  const mode = parseStorageOrphanReconciliationMode(args);
  const { PrismaService } = await import('./platform/prisma.service');
  const { PrismaStorageReferenceRepository } =
    await import('./programs/prisma-storage-reference.repository');
  const { PlatformModule } = await import('./platform/platform.module');
  const prisma = new PrismaService();
  const references = new PrismaStorageReferenceRepository(prisma);
  let context: INestApplicationContext | undefined;

  try {
    context = await NestFactory.createApplicationContext(PlatformModule, {
      logger: false,
      abortOnError: false,
    });
    await runStorageOrphanReconciliation(
      mode,
      references,
      context.get<ObjectStoragePort>(OBJECT_STORAGE),
      context.get<ObjectInventoryPort>(OBJECT_INVENTORY),
    );
  } finally {
    try {
      await prisma.$disconnect();
    } finally {
      await context?.close();
    }
  }
}

async function sendDeadlineDigest(): Promise<void> {
  const logger = new Logger('send-deadline-digest-cli');
  const { DeadlineDigestService } =
    await import('./notifications/deadline-digest.service');
  const forceToValue = PROCESS_RUNTIME_CONFIG.DIGEST_FORCE_TO;

  if (forceToValue !== undefined) {
    await DeadlineDigestService.sendForcedDeadlineDigest(
      PROCESS_RUNTIME_CONFIG,
      forceToValue,
      logger,
    );
    return;
  }

  const { AppModule } = await import('./app.module');
  const app = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false,
  });
  app.useLogger(
    new ConsoleLogger('Nest', { logLevels: ['error', 'warn', 'log'] }),
  );
  try {
    await app.get(DeadlineDigestService).sendDeadlineDigests(new Date());
    logger.log('sendDeadlineDigests 완료');
  } finally {
    await app.close();
  }
}

interface CliCommand {
  run(args: readonly string[]): Promise<void>;
  failureMessage(error: unknown): string;
}

const COMMANDS = new Map<string, CliCommand>([
  [
    'retry-submission-file-cleanup',
    {
      run: retrySubmissionFileCleanup,
      failureMessage: () => 'Submission file cleanup retry failed',
    },
  ],
  [
    'reconcile-storage-orphans',
    {
      run: reconcileStorageOrphans,
      failureMessage: () => 'Storage orphan reconciliation failed',
    },
  ],
  [
    'send-deadline-digest',
    {
      run: sendDeadlineDigest,
      failureMessage: (error) =>
        error instanceof InvalidDigestForceToError
          ? INVALID_DIGEST_FORCE_TO_MESSAGE
          : 'Deadline digest command failed.',
    },
  ],
]);

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const [name, ...args] = argv;
  const command = name === undefined ? undefined : COMMANDS.get(name);
  if (command === undefined) {
    process.stderr.write(
      `Usage: cli <command> [args]\nCommands: ${[...COMMANDS.keys()].join(', ')}\n`,
    );
    process.exitCode = 1;
    return;
  }
  try {
    await command.run(args);
  } catch (error) {
    process.stderr.write(`${command.failureMessage(error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void runCli();
}

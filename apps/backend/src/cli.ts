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
  OBJECT_INVENTORY,
  OBJECT_STORAGE,
  type ObjectInventoryPort,
  type ObjectStoragePort,
} from './platform/object-storage.types';
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

export async function reconcileStorageOrphans(
  args: readonly string[],
): Promise<void> {
  const {
    parseStorageOrphanReconciliationMode,
    runStorageOrphanReconciliation,
  } = await import('./programs/storage-orphan-reconciliation.service');
  const mode = parseStorageOrphanReconciliationMode(args);
  const { createStorageReferenceRepository } =
    await import('./programs/prisma-storage-reference.repository');
  const { PlatformModule } = await import('./platform/platform.module');
  const { references, disconnect } = createStorageReferenceRepository();
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
      await disconnect();
    } finally {
      await context?.close();
    }
  }
}

async function sendDeadlineDigest(): Promise<void> {
  const logger = new Logger('send-deadline-digest-cli');
  const { DeadlineDigestService, sendForcedDeadlineDigest } =
    await import('./notifications/deadline-digest.service');
  const forceToValue = PROCESS_RUNTIME_CONFIG.DIGEST_FORCE_TO;

  if (forceToValue !== undefined) {
    await sendForcedDeadlineDigest(
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

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { CollectionConfig } from '../collection.config';
import { CollectionService } from '../collection.service';
import { COLLECTION_RUN_STATUSES } from '../domain/collection-run';

async function collectBatch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const config = app.get(CollectionConfig);
    const service = app.get(CollectionService);
    const runs = await service.runBatch(config.batchLogins);

    for (const run of runs) {
      console.log(
        `profileCount=${run.profileCount} repoCount=${run.repoCount} eventCount=${run.eventCount}`,
      );
    }

    const hasFailure =
      runs.length !== config.batchLogins.length ||
      runs.some((run) => run.status !== COLLECTION_RUN_STATUSES.SUCCEEDED);
    if (hasFailure) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void collectBatch().catch((error: unknown) => {
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  console.error(`collection batch failed: ${errorName}`);
  process.exitCode = 1;
});

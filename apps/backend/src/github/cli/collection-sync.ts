import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import type { PrismaService } from '../../prisma/prisma.service';
import { CollectionAppClient } from '../collection-app.client';
import { CollectionAppConfig } from '../collection-app.config';
import { CollectionAppTokenProvider } from '../collection-app.token';
import { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';
import { ProviderRequestQueue } from '../collection-provider-queue';
import {
  CollectionSyncRuntime,
  CollectionSyncService,
} from '../service/collection-sync.service';

/**
 * public-admin-exposure todo 10 — repository별 증분 동기화 CLI. inventory 관찰,
 * 신규/미검증 저장소 backfill, READY 저장소 조건부 poll을 한 fair serial provider
 * queue 위에서 lease-fenced로 수행한다. See `CollectionSyncService` for the
 * full contract.
 */
async function main(): Promise<void> {
  const runtimeConfig = loadRuntimeConfig(process.env);
  const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
  const organizationLogin = config.orgLogin.toLowerCase();
  const tokens = new CollectionAppTokenProvider(config);
  const queue = new ProviderRequestQueue();
  const client = new CollectionAppClient(
    config,
    tokens,
    queue.wrapFetcher(globalThis.fetch),
  );

  const prisma = new PrismaClient();
  const db = prisma as unknown as PrismaService;
  try {
    const service = new CollectionSyncService(
      new CollectionIncrementalRepository(db),
      (): CollectionSyncRuntime => ({
        appId: config.appId,
        organizationLogin,
        tokens,
        client,
        queue,
      }),
      async () => {
        const identity = await tokens.getInstallationIdentity();
        return BigInt(identity.organizationId);
      },
    );
    const result = await service.run(`cli:${randomUUID()}`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'FAILED') process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error('[collection-sync] failed:', error);
    process.exitCode = 1;
  });
}

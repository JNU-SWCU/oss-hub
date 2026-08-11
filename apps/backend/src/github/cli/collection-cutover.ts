import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import type { PrismaService } from '../../prisma/prisma.service';
import { CollectionAppClient } from '../collection-app.client';
import { CollectionAppConfig } from '../collection-app.config';
import { CollectionAppTokenProvider } from '../collection-app.token';
import { CollectionCanonicalRepository } from '../repository/collection-canonical.repository';
import { CollectionCutoverRepository } from '../repository/collection-cutover.repository';
import { CollectionCutoverService } from '../service/collection-cutover.service';
import { CollectionGenerationImportService } from '../service/collection-generation-import.service';
import { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';
import { ProviderRequestQueue } from '../collection-provider-queue';
import {
  CollectionSyncRuntime,
  CollectionSyncService,
} from '../service/collection-sync.service';

/**
 * public-admin-exposure todo 14 — ADR-006 "누적 저장소로의 1회 전환" 원자 절차를 사람이
 * 지켜보며 실행하는 CLI. `CollectionCutoverLease` 아래에서 마지막 성공 generation을
 * pin하고, todo 8 backfill을 재실행하고, 포인터 불변을 확인하고, todo 10 provider
 * traversal로 VERIFYING stream을 모두 검증하고, 원장/facts 개수를 비교한다. 다섯 단계
 * 중 어느 하나라도 실패하면 명시적 사유와 함께 ABORTED로 종료한다(예외를 던지지 않는다) —
 * 이 CLI의 종료 코드/stdout이 곧 cutover를 실제로 배포에 반영해도 되는지의 운영 증거다.
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
    const canonicalRepository = new CollectionCanonicalRepository(db);
    const incrementalRepository = new CollectionIncrementalRepository(db);
    const cutoverRepository = new CollectionCutoverRepository(db);
    const resolveGithubOrganizationId = async (): Promise<bigint> => {
      const identity = await tokens.getInstallationIdentity();
      return BigInt(identity.organizationId);
    };
    const generationImportService = new CollectionGenerationImportService(
      canonicalRepository,
      incrementalRepository,
      resolveGithubOrganizationId,
    );
    const syncService = new CollectionSyncService(
      incrementalRepository,
      (): CollectionSyncRuntime => ({
        appId: config.appId,
        organizationLogin,
        tokens,
        client,
        queue,
      }),
      resolveGithubOrganizationId,
    );
    const service = new CollectionCutoverService(
      canonicalRepository,
      generationImportService,
      syncService,
      cutoverRepository,
      incrementalRepository,
      () =>
        Promise.resolve({
          appId: BigInt(config.appId),
          organizationLogin,
        }),
    );

    const result = await service.runCutover(`cli:${randomUUID()}`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'ABORTED') process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error('[collection-cutover] failed:', error);
    process.exitCode = 1;
  });
}

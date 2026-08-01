import { PrismaClient } from '@prisma/client';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import type { PrismaService } from '../../prisma/prisma.service';
import { CollectionAppConfig } from '../collection-app.config';
import { CollectionAppTokenProvider } from '../collection-app.token';
import { CollectionCanonicalRepository } from '../collection-canonical.repository';
import { CollectionIncrementalRepository } from '../collection-incremental.repository';
import { CollectionGenerationImportService } from '../collection-generation-import.service';

/**
 * public-admin-exposure todo 8 — one-shot backfill CLI. Converts the latest
 * successful active canonical generation into ADR-006 stable-ID facts/state/
 * aggregates. Safe to re-run: see `CollectionGenerationImportService` for the
 * idempotency contract. Does not claim any provider-observed safe frontier —
 * imported streams stay `VERIFYING` until the separate sync orchestration
 * (todo 10) runs a real traversal.
 */
async function main(): Promise<void> {
  const runtimeConfig = loadRuntimeConfig(process.env);
  const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
  const organizationLogin = config.orgLogin.toLowerCase();
  const tokens = new CollectionAppTokenProvider(config);

  const prisma = new PrismaClient();
  const db = prisma as unknown as PrismaService;
  try {
    const service = new CollectionGenerationImportService(
      new CollectionCanonicalRepository(db),
      new CollectionIncrementalRepository(db),
      async () => {
        const identity = await tokens.getInstallationIdentity();
        return BigInt(identity.organizationId);
      },
    );
    const result = await service.importActiveGeneration({
      appId: BigInt(config.appId),
      organizationLogin,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.imported) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error('[collection-generation-import] failed:', error);
    process.exitCode = 1;
  });
}

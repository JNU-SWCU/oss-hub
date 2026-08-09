import { MODULE_METADATA } from '@nestjs/common/constants';
import { ScheduleModule } from '@nestjs/schedule';
import { ConsentsModule } from '../consents/consents.module';
import { ConsentsService } from '../consents/consents.service';
import { PrismaService } from '../prisma/prisma.service';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { CollectionAdminController } from './controller/collection-admin.controller';
import { CollectionCanonicalRepository } from './repository/collection-canonical.repository';
import { CollectionDiscoveryClient } from './collection-discovery.client';
import { CollectionExternalDiscoveryService } from './service/collection-external-discovery.service';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { ProviderRequestQueue } from './collection-provider-queue';
import { CollectionPublicTokenProvider } from './collection-public.token';
import { COLLECTION_READ_PORT } from './collection-read.port';
import { CollectionReadService } from './service/collection-read.service';
import { CollectionReconciliationService } from './service/collection-reconciliation.service';
import { CollectionSchedulerService } from './service/collection-scheduler.service';
import {
  CollectionSyncRuntime,
  CollectionSyncService,
} from './service/collection-sync.service';

import { CollectionModule } from './collection.module';
const getMetadataArray = (key: string): unknown[] => {
  const metadata = Reflect.getMetadata(key, CollectionModule) as unknown;
  expect(Array.isArray(metadata)).toBe(true);
  return Array.isArray(metadata) ? metadata : [];
};

interface CollectionSyncServiceProviderEntry {
  provide: unknown;
  inject: unknown[];
  useFactory: (...args: unknown[]) => CollectionSyncService;
}

function findCollectionSyncServiceProvider(
  providers: unknown[],
): CollectionSyncServiceProviderEntry {
  const entry = providers.find(
    (candidate): candidate is CollectionSyncServiceProviderEntry =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'provide' in candidate &&
      (candidate as { provide?: unknown }).provide === CollectionSyncService,
  );
  expect(entry).toBeDefined();
  if (!entry) throw new Error('unreachable — asserted above');
  return entry;
}

describe('CollectionModule', () => {
  it('ScheduleModule을 초기화한다', () => {
    const imports = getMetadataArray(MODULE_METADATA.IMPORTS);

    expect(
      imports.some(
        (entry: unknown) =>
          typeof entry === 'object' &&
          entry !== null &&
          'module' in entry &&
          entry.module === ScheduleModule,
      ),
    ).toBe(true);
  });

  it('canonical reconciliation providers and admin surface are reachable', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const controllers = getMetadataArray(MODULE_METADATA.CONTROLLERS);
    const exports = getMetadataArray(MODULE_METADATA.EXPORTS);

    expect(providers).toEqual(
      expect.arrayContaining([
        CollectionCanonicalRepository,
        CollectionSchedulerService,
        expect.objectContaining({ provide: CollectionReconciliationService }),
      ]),
    );
    expect(controllers).toContain(CollectionAdminController);
    expect(exports).not.toContain(CollectionReconciliationService);
  });

  it('exports the read-port token without exposing its concrete implementation', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const exports = getMetadataArray(MODULE_METADATA.EXPORTS);

    expect(providers).toEqual(
      expect.arrayContaining([
        CollectionReadService,
        expect.objectContaining({
          provide: COLLECTION_READ_PORT,
          useExisting: CollectionReadService,
        }),
      ]),
    );
    expect(exports).toContain(COLLECTION_READ_PORT);
    expect(exports).not.toContain(CollectionReadService);
  });

  it('retires webhook ingress and legacy collection runtime from the module', () => {
    const controllers = getMetadataArray(MODULE_METADATA.CONTROLLERS);
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const names = [...controllers, ...providers].map((entry) =>
      typeof entry === 'function'
        ? entry.name
        : ((entry as { provide?: { name?: string } }).provide?.name ?? ''),
    );
    expect(names).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Webhook|GithubApiClient|CollectionService/),
      ]),
    );
    expect(controllers).toHaveLength(1);
  });

  it('ConsentsModule을 초기화해 동의 게이트 재사용 경로를 사용할 수 있게 한다', () => {
    const imports = getMetadataArray(MODULE_METADATA.IMPORTS);

    expect(imports).toContain(ConsentsModule);
  });

  it('CollectionDiscoveryClient가 CollectionPublicTokenProvider를 주입받도록 배선한다', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: CollectionDiscoveryClient,
          inject: [CollectionPublicTokenProvider],
        }),
      ]),
    );
  });

  it('CollectionExternalDiscoveryService가 discovery client·증분 저장소·동의 서비스를 주입받도록 배선한다', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: CollectionExternalDiscoveryService,
          inject: [
            PrismaService,
            ConsentsService,
            CollectionIncrementalRepository,
            CollectionDiscoveryClient,
          ],
        }),
      ]),
    );
  });

  it('CollectionSyncService가 CollectionPublicTokenProvider를 주입받아 E1 external sweep runtime factory를 갖는다', async () => {
    // Given: 실제 모듈 metadata에서 CollectionSyncService factory를 꺼낸다.
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const provider = findCollectionSyncServiceProvider(providers);

    expect(provider.inject).toEqual([
      CollectionIncrementalRepository,
      RUNTIME_CONFIG,
      CollectionPublicTokenProvider,
    ]);

    // When: 합성 fixture로 factory를 직접 호출해 실제 서비스 인스턴스를 얻는다.
    const runtimeConfig = loadRuntimeConfig({
      GITHUB_COLLECTION_APP_ID: '12345',
      GITHUB_APP_ORG: 'synthetic-org',
      GITHUB_COLLECTION_APP_PRIVATE_KEY: 'synthetic-private-key',
    });
    const fakeIncrementalRepository = {} as CollectionIncrementalRepository;
    const fakePublicTokens = {
      getToken: jest.fn(),
      clear: jest.fn(),
    } as unknown as CollectionPublicTokenProvider;
    const service = provider.useFactory(
      fakeIncrementalRepository,
      runtimeConfig,
      fakePublicTokens,
    );

    const orgRuntime = await (
      service as unknown as {
        runtimeFactory: () =>
          Promise<CollectionSyncRuntime> | CollectionSyncRuntime;
      }
    ).runtimeFactory();
    const externalRuntimeFactory = (
      service as unknown as {
        externalRuntimeFactory?: () =>
          Promise<CollectionSyncRuntime> | CollectionSyncRuntime;
      }
    ).externalRuntimeFactory;
    expect(externalRuntimeFactory).toBeDefined();
    const externalRuntime =
      (await externalRuntimeFactory?.()) as CollectionSyncRuntime;

    // Then: external runtime은 주입된 CollectionPublicTokenProvider로 인증하고,
    // org runtime과는 별도의 ProviderRequestQueue 인스턴스를 쓴다(독립 5,000/hr 예산).
    expect(externalRuntime.tokens).toBe(fakePublicTokens);
    expect(externalRuntime.queue).toBeInstanceOf(ProviderRequestQueue);
    expect(externalRuntime.queue).not.toBe(orgRuntime.queue);
  });
});

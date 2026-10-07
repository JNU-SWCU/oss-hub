import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { CollectionAdminController } from './controller/collection-admin.controller';
import { CollectionDiscoveryClient } from './collection-discovery.client';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { ProviderRequestQueue } from './collection-provider-queue';
import { CollectionPublicTokenProvider } from './collection-public.token';
import { CollectionReadService } from './service/collection-read.service';
import { CollectionSchedulerService } from './service/collection-scheduler.service';
import { CollectionUserActivityService } from './service/collection-user-activity.service';
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
  let privateKeyWorkspace: string;
  let privateKeyFile: string;

  beforeAll(() => {
    privateKeyWorkspace = mkdtempSync(join(tmpdir(), 'collection-module-'));
    privateKeyFile = join(privateKeyWorkspace, 'collection.pem');
    writeFileSync(
      privateKeyFile,
      generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }),
    );
  });

  afterAll(() => {
    rmSync(privateKeyWorkspace, { recursive: true, force: true });
  });

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

  it('sync writer and admin surface are reachable', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const controllers = getMetadataArray(MODULE_METADATA.CONTROLLERS);

    expect(providers).toEqual(
      expect.arrayContaining([
        CollectionSchedulerService,
        expect.objectContaining({ provide: CollectionSyncService }),
      ]),
    );
    expect(controllers).toContain(CollectionAdminController);
  });

  it('does not re-register any provider bound to the dropped canonical tables', () => {
    const names = getMetadataArray(MODULE_METADATA.PROVIDERS).map((provider) =>
      typeof provider === 'function'
        ? provider.name
        : typeof provider === 'object' &&
            provider !== null &&
            'provide' in provider &&
            typeof provider.provide === 'function'
          ? provider.provide.name
          : String(provider),
    );

    expect(names).not.toContain('CollectionCanonicalRepository');
    expect(names).not.toContain('CollectionReconciliationService');
    expect(names).not.toContain('CollectionCutoverService');
    expect(names).not.toContain('CollectionGenerationImportService');
  });

  it('does not export COLLECTION_READ_PORT or CollectionReadService', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const exports = getMetadataArray(MODULE_METADATA.EXPORTS);
    const exportNames = exports.map((entry) =>
      typeof entry === 'function'
        ? entry.name
        : typeof entry === 'symbol'
          ? entry.description
          : String(entry),
    );

    expect(providers).toEqual(expect.arrayContaining([CollectionReadService]));
    expect(exports).not.toContain(CollectionReadService);
    expect(exportNames).not.toContain('COLLECTION_READ_PORT');
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

  it('배경 수집 모듈은 동의 모듈에 더 이상 의존하지 않는다', () => {
    const imports = getMetadataArray(MODULE_METADATA.IMPORTS);
    const names = imports.map((entry) =>
      typeof entry === 'function' ? entry.name : String(entry),
    );

    expect(names).not.toContain('ConsentsModule');
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

  it('CollectionUserActivityService가 prisma·discovery client를 주입받도록 배선한다', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: CollectionUserActivityService,
          inject: [PrismaService, CollectionDiscoveryClient],
        }),
      ]),
    );
  });

  it('CollectionSyncService가 CollectionPublicTokenProvider를 주입받아 E1 external sweep runtime factory를 갖는다', async () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const provider = findCollectionSyncServiceProvider(providers);

    expect(provider.inject).toEqual([
      CollectionIncrementalRepository,
      RUNTIME_CONFIG,
      CollectionPublicTokenProvider,
    ]);

    const runtimeConfig = loadRuntimeConfig({
      GITHUB_COLLECTION_APP_ID: '12345',
      GITHUB_APP_ORG: 'synthetic-org',
      GITHUB_COLLECTION_APP_PRIVATE_KEY_FILE: privateKeyFile,
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

    expect(externalRuntime.tokens).toBe(fakePublicTokens);
    expect(externalRuntime.queue).toBeInstanceOf(ProviderRequestQueue);
    expect(externalRuntime.queue).not.toBe(orgRuntime.queue);
  });
});

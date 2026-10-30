import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConsentsService } from '../users/consents.service';
import { ScheduleModule } from '@nestjs/schedule';
import { CollectionUserActivityRepository } from './repository-provision-job.repository';
import { RUNTIME_CONFIG } from '../platform/runtime-config-instance.config';
import { loadRuntimeConfig } from '../platform/runtime-config.config';
import { CollectionAdminService } from './collection-admin.service';
import {
  CollectionDiscoveryClient,
  ProviderRequestQueue,
} from './collection-discovery.client';
import { CollectionIncrementalRepository } from './collection-incremental.repository';
import { CollectionPublicTokenProvider } from './collection-providers.service';
import {
  CollectionScheduler,
  CollectionTriggerService,
} from './collection-trigger.service';
import { CollectionUserActivityService } from './collection-user-activity.service';
import {
  CollectionSyncRuntime,
  CollectionSyncService,
} from './collection-sync.service';
import { GithubModule } from './github.module';
import { OwnRepositoryUrlValidationService } from './own-repository-url-validation.service';
import { RepositoriesReadService } from './repositories-read.service';
import {
  RepositoriesService,
  RepositoryOwnEnrollmentService,
} from './repositories.service';

const getMetadataArray = (key: string): unknown[] => {
  const metadata = Reflect.getMetadata(key, GithubModule) as unknown;
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

describe('GithubModule', () => {
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

  it('sync writer and admin service are reachable', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    expect(providers).toEqual(
      expect.arrayContaining([
        CollectionAdminService,
        CollectionScheduler,
        CollectionTriggerService,
        expect.objectContaining({ provide: CollectionSyncService }),
      ]),
    );
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

    const providerNames = providers.map((provider) =>
      typeof provider === 'function' ? provider.name : String(provider),
    );
    expect(providerNames).not.toContain('CollectionReadService');
    expect(exportNames).not.toContain('CollectionReadService');
    expect(exportNames).not.toContain('COLLECTION_READ_PORT');
  });

  it('수집 진입과 저장소 서비스만 구체 클래스로 공개하고 별칭을 등록하지 않는다', () => {
    expect(getMetadataArray(MODULE_METADATA.EXPORTS)).toEqual([
      CollectionAdminService,
      CollectionTriggerService,
      RepositoriesService,
      RepositoriesReadService,
      OwnRepositoryUrlValidationService,
    ]);
    expect(
      getMetadataArray(MODULE_METADATA.PROVIDERS).some(
        (provider) =>
          typeof provider === 'object' &&
          provider !== null &&
          'useExisting' in provider,
      ),
    ).toBe(false);
  });

  it('retires webhook ingress and legacy collection runtime from the module', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const names = providers.map((entry) =>
      typeof entry === 'function'
        ? entry.name
        : ((entry as { provide?: { name?: string } }).provide?.name ?? ''),
    );
    expect(names).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Webhook|GithubApiClient|CollectionService/),
      ]),
    );
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, GithubModule)).toBe(
      undefined,
    );
  });

  it('동의 서비스는 저장소 본인 등록만 의존하고 배경 수집은 의존하지 않는다', () => {
    const consumers = getMetadataArray(MODULE_METADATA.PROVIDERS).flatMap(
      (provider): unknown[] => {
        const dependencies =
          typeof provider === 'function'
            ? ((Reflect.getMetadata('design:paramtypes', provider) as
                unknown[] | undefined) ?? [])
            : ((provider as { inject?: unknown[] }).inject ?? []);
        if (!dependencies.includes(ConsentsService)) return [];
        return [
          typeof provider === 'function'
            ? provider
            : (provider as { provide?: unknown }).provide,
        ];
      },
    );

    expect(consumers).toEqual([RepositoryOwnEnrollmentService]);
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

  it('CollectionUserActivityService가 repository·discovery client를 주입받도록 배선한다', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: CollectionUserActivityService,
          inject: [CollectionUserActivityRepository, CollectionDiscoveryClient],
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

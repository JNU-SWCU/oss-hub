import { MODULE_METADATA } from '@nestjs/common/constants';
import { ScheduleModule } from '@nestjs/schedule';
import { CollectionAdminController } from './collection-admin.controller';
import { CollectionCanonicalRepository } from './collection-canonical.repository';
import { COLLECTION_READ_PORT } from './collection-read.port';
import { CollectionReadService } from './collection-read.service';
import { CollectionReconciliationService } from './collection-reconciliation.service';
import { CollectionSchedulerService } from './collection-scheduler.service';

import { CollectionModule } from './collection.module';
const getMetadataArray = (key: string): unknown[] => {
  const metadata = Reflect.getMetadata(key, CollectionModule) as unknown;
  expect(Array.isArray(metadata)).toBe(true);
  return Array.isArray(metadata) ? metadata : [];
};

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
    expect(exports).toContain(CollectionReconciliationService);
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
});

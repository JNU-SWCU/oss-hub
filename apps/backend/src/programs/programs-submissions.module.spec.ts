import { MODULE_METADATA } from '@nestjs/common/constants';
import { PlatformModule } from '../platform/platform.module';
import { SubmissionDashboardSummaryService } from './submission-dashboard-summary.service';
import { SubmissionFileCleanupRetryService } from './submission-file-cleanup.service';
import { SubmissionFilesRepository } from './submission-files.repository';
import { SubmissionFilesService } from './submission-files.service';
import { S3ObjectStorageClient } from '../platform/s3-object-storage.client';
import { OBJECT_STORAGE } from '../platform/object-storage.config';
import { ProgramsModule } from './programs.module';

const getMetadataArray = (key: string): unknown[] => {
  const metadata = Reflect.getMetadata(key, ProgramsModule) as unknown;
  expect(Array.isArray(metadata)).toBe(true);
  return Array.isArray(metadata) ? metadata : [];
};

describe('ProgramsModule submission storage provider', () => {
  it('imports the storage capability without registering or exporting an adapter alias', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    const storageProvider = providers.find(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        provider.provide === OBJECT_STORAGE,
    );

    expect(getMetadataArray(MODULE_METADATA.IMPORTS)).toContain(PlatformModule);
    expect(storageProvider).toBeUndefined();
    expect(providers).not.toContain(S3ObjectStorageClient);
    expect(getMetadataArray(MODULE_METADATA.EXPORTS)).not.toContain(
      OBJECT_STORAGE,
    );
  });

  it('exports the concrete dashboard summary service without provider aliases', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const exports = getMetadataArray(MODULE_METADATA.EXPORTS);

    expect(providers).toContain(SubmissionDashboardSummaryService);
    expect(
      providers.some(
        (provider) =>
          typeof provider === 'object' &&
          provider !== null &&
          'useExisting' in provider,
      ),
    ).toBe(false);
    expect(exports).toContain(SubmissionDashboardSummaryService);
  });

  it('exports the submission file service while the repository stays module-internal', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const exports = getMetadataArray(MODULE_METADATA.EXPORTS);

    expect(providers).toContain(SubmissionFilesService);
    expect(exports).toContain(SubmissionFilesService);
    expect(providers).toContain(SubmissionFilesRepository);
    expect(exports).not.toContain(SubmissionFilesRepository);
  });

  it('wires cleanup retry orchestration with the audit provider module', () => {
    expect(getMetadataArray(MODULE_METADATA.IMPORTS)).toContain(PlatformModule);
    expect(getMetadataArray(MODULE_METADATA.PROVIDERS)).toContain(
      SubmissionFileCleanupRetryService,
    );
    expect(getMetadataArray(MODULE_METADATA.EXPORTS)).not.toContain(
      SubmissionFileCleanupRetryService,
    );
  });
});

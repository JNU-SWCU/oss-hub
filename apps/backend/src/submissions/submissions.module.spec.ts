import { MODULE_METADATA } from '@nestjs/common/constants';
import { SubmissionDashboardSummaryService } from './submission-dashboard-summary.service';
import { SubmissionFileCleanupFailuresController } from './submission-file-cleanup-failures.controller';
import { SubmissionFileCleanupFailuresService } from './submission-file-cleanup-failures.service';
import { S3ObjectStorage } from '../storage/gateway/s3-object.storage';
import { OBJECT_STORAGE } from '../storage/domain/object-storage';
import { StorageModule } from '../storage/storage.module';
import { SubmissionsModule } from './submissions.module';

const getMetadataArray = (key: string): unknown[] => {
  const metadata = Reflect.getMetadata(key, SubmissionsModule) as unknown;
  expect(Array.isArray(metadata)).toBe(true);
  return Array.isArray(metadata) ? metadata : [];
};

describe('SubmissionsModule storage provider', () => {
  it('imports the storage capability without registering or exporting an adapter alias', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    const storageProvider = providers.find(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        provider.provide === OBJECT_STORAGE,
    );

    expect(getMetadataArray(MODULE_METADATA.IMPORTS)).toContain(StorageModule);
    expect(storageProvider).toBeUndefined();
    expect(providers).not.toContain(S3ObjectStorage);
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

  it('registers the operator-facing cleanup exhaustion read surface (#545)', () => {
    const controllers = getMetadataArray(MODULE_METADATA.CONTROLLERS);
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    expect(controllers).toContain(SubmissionFileCleanupFailuresController);
    expect(providers).toContain(SubmissionFileCleanupFailuresService);
  });
});

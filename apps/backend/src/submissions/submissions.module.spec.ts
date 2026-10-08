import { MODULE_METADATA } from '@nestjs/common/constants';
import { SUBMISSION_DASHBOARD_SUMMARY_PORT } from './submission-dashboard-summary.port';
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

  it('exports the dashboard summary read port without exporting the concrete service', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const exports = getMetadataArray(MODULE_METADATA.EXPORTS);

    expect(providers).toEqual(
      expect.arrayContaining([
        SubmissionDashboardSummaryService,
        expect.objectContaining({
          provide: SUBMISSION_DASHBOARD_SUMMARY_PORT,
          useExisting: SubmissionDashboardSummaryService,
        }),
      ]),
    );
    expect(exports).toContain(SUBMISSION_DASHBOARD_SUMMARY_PORT);
    expect(exports).not.toContain(SubmissionDashboardSummaryService);
  });

  it('registers the operator-facing cleanup exhaustion read surface (#545)', () => {
    const controllers = getMetadataArray(MODULE_METADATA.CONTROLLERS);
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    expect(controllers).toContain(SubmissionFileCleanupFailuresController);
    expect(providers).toContain(SubmissionFileCleanupFailuresService);
  });
});

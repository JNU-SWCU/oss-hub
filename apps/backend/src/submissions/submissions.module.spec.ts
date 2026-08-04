import { MODULE_METADATA } from '@nestjs/common/constants';
import { SUBMISSION_DASHBOARD_SUMMARY_PORT } from './submission-dashboard-summary.port';
import { SubmissionDashboardSummaryService } from './submission-dashboard-summary.service';
import { SubmissionFileCleanupFailuresController } from './submission-file-cleanup-failures.controller';
import { SubmissionFileCleanupFailuresService } from './submission-file-cleanup-failures.service';
import { SubmissionsModule } from './submissions.module';

const getMetadataArray = (key: string): unknown[] => {
  const metadata = Reflect.getMetadata(key, SubmissionsModule) as unknown;
  expect(Array.isArray(metadata)).toBe(true);
  return Array.isArray(metadata) ? metadata : [];
};

describe('SubmissionsModule', () => {
  it('exports the dashboard summary read port without exporting the concrete service', () => {
    // Given
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
    // Given
    const controllers = getMetadataArray(MODULE_METADATA.CONTROLLERS);
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    // Then
    expect(controllers).toContain(SubmissionFileCleanupFailuresController);
    expect(providers).toContain(SubmissionFileCleanupFailuresService);
  });
});

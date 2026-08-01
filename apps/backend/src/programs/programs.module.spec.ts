import { MODULE_METADATA } from '@nestjs/common/constants';
import { PROGRAM_ACTIVITY_SUMMARY_PORT } from './program-activity-summary.port';
import { ProgramActivitySummaryService } from './program-activity-summary.service';
import { ProgramsModule } from './programs.module';

const getMetadataArray = (key: string): unknown[] => {
  const metadata = Reflect.getMetadata(key, ProgramsModule) as unknown;
  expect(Array.isArray(metadata)).toBe(true);
  return Array.isArray(metadata) ? metadata : [];
};

describe('ProgramsModule', () => {
  it('exports the activity summary read port without exporting the concrete service', () => {
    // Given
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const exports = getMetadataArray(MODULE_METADATA.EXPORTS);

    expect(providers).toEqual(
      expect.arrayContaining([
        ProgramActivitySummaryService,
        expect.objectContaining({
          provide: PROGRAM_ACTIVITY_SUMMARY_PORT,
          useExisting: ProgramActivitySummaryService,
        }),
      ]),
    );
    expect(exports).toContain(PROGRAM_ACTIVITY_SUMMARY_PORT);
    expect(exports).not.toContain(ProgramActivitySummaryService);
  });
});

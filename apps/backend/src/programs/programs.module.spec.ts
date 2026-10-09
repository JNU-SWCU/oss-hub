import { MODULE_METADATA } from '@nestjs/common/constants';
import { ProgramActivitySummaryService } from './service/program-activity-summary.service';
import { ProgramsModule } from './programs.module';

const getMetadataArray = (key: string): unknown[] => {
  const metadata = Reflect.getMetadata(key, ProgramsModule) as unknown;
  expect(Array.isArray(metadata)).toBe(true);
  return Array.isArray(metadata) ? metadata : [];
};

describe('ProgramsModule', () => {
  it('exports the concrete activity summary service without provider aliases', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const exports = getMetadataArray(MODULE_METADATA.EXPORTS);

    expect(providers).toContain(ProgramActivitySummaryService);
    expect(
      providers.some(
        (provider) =>
          typeof provider === 'object' &&
          provider !== null &&
          'useExisting' in provider,
      ),
    ).toBe(false);
    expect(exports).toContain(ProgramActivitySummaryService);
  });
});

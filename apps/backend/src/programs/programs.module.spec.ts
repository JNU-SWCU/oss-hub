import { MODULE_METADATA } from '@nestjs/common/constants';
import { ProgramActivitySummaryService } from './program-activity-summary.service';
import { PlatformModule } from '../platform/platform.module';
import { ProgramsModule } from './programs.module';
import {
  PublicEligibilityService,
  PublicProjectsService,
} from './public-projects.service';
import { PublicProjectsController } from './public-projects.controller';
import { PublicProjectsRepository } from './public-projects.repository';

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

  it('공개 적격성 service를 provider로 등록하고 PlatformModule을 import한다', () => {
    expect(getMetadataArray(MODULE_METADATA.IMPORTS)).toContain(PlatformModule);
    expect(getMetadataArray(MODULE_METADATA.PROVIDERS)).toContain(
      PublicEligibilityService,
    );
  });

  it('공개 프로젝트 컨트롤러를 등록하고 서비스를 export 계약으로 노출한다', () => {
    expect(getMetadataArray(MODULE_METADATA.CONTROLLERS)).toContain(
      PublicProjectsController,
    );
    expect(getMetadataArray(MODULE_METADATA.EXPORTS)).toContain(
      PublicProjectsService,
    );
  });

  it('공개 프로젝트 repository/service를 provider로 등록한다', () => {
    expect(getMetadataArray(MODULE_METADATA.PROVIDERS)).toEqual(
      expect.arrayContaining([PublicProjectsRepository, PublicProjectsService]),
    );
  });
});

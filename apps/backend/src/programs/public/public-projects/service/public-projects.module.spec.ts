import { MODULE_METADATA } from '@nestjs/common/constants';
import { PlatformModule } from '../../../../platform/platform.module';
import { PublicEligibilityModule } from '../../public-eligibility/public-eligibility.module';
import { PublicProjectsController } from '../controller/public-projects.controller';
import { PublicProjectsModule } from '../public-projects.module';
import { PublicProjectsRepository } from '../repository/public-projects.repository';
import { PublicProjectsService } from './public-projects.service';

describe('PublicProjectsModule', () => {
  const getMetadataArray = (key: string): unknown[] => {
    const metadata = Reflect.getMetadata(key, PublicProjectsModule) as unknown;
    expect(Array.isArray(metadata)).toBe(true);
    return Array.isArray(metadata) ? metadata : [];
  };

  it('todo 15의 PublicEligibilityModule을 import한다', () => {
    const imports = getMetadataArray(MODULE_METADATA.IMPORTS);

    expect(imports).toEqual(
      expect.arrayContaining([PlatformModule, PublicEligibilityModule]),
    );
  });

  it('공개 프로젝트 컨트롤러를 등록하고 서비스를 export 계약으로 노출한다', () => {
    expect(getMetadataArray(MODULE_METADATA.CONTROLLERS)).toEqual([
      PublicProjectsController,
    ]);
    expect(getMetadataArray(MODULE_METADATA.EXPORTS)).toEqual([
      PublicProjectsService,
    ]);
  });

  it('repository/service를 provider로 등록한다', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    expect(providers).toEqual(
      expect.arrayContaining([PublicProjectsRepository, PublicProjectsService]),
    );
  });
});

import { MODULE_METADATA } from '@nestjs/common/constants';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PublicEligibilityModule } from '../../../programs/archive/public-eligibility/public-eligibility.module';
import { PublicProjectsController } from './public-projects.controller';
import { PublicProjectsModule } from './public-projects.module';
import { PublicProjectsRepository } from './public-projects.repository';
import { PublicProjectsService } from './public-projects.service';
import { PublicUserProfileController } from './public-user-profile.controller';

describe('PublicProjectsModule', () => {
  const getMetadataArray = (key: string): unknown[] => {
    const metadata = Reflect.getMetadata(key, PublicProjectsModule) as unknown;
    expect(Array.isArray(metadata)).toBe(true);
    return Array.isArray(metadata) ? metadata : [];
  };

  it('todo 15의 PublicEligibilityModule을 import한다', () => {
    const imports = getMetadataArray(MODULE_METADATA.IMPORTS);

    expect(imports).toEqual(
      expect.arrayContaining([PrismaModule, PublicEligibilityModule]),
    );
  });

  it('두 컨트롤러(/projects, /users/:userId/public-profile)를 모두 등록한다', () => {
    const controllers = getMetadataArray(MODULE_METADATA.CONTROLLERS);

    expect(controllers).toEqual(
      expect.arrayContaining([
        PublicProjectsController,
        PublicUserProfileController,
      ]),
    );
  });

  it('repository/service를 provider로 등록한다', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    expect(providers).toEqual(
      expect.arrayContaining([PublicProjectsRepository, PublicProjectsService]),
    );
  });
});

import { Module } from '@nestjs/common';
import { PlatformModule } from '../../../platform/platform.module';
import { PublicEligibilityModule } from '../../../programs/public/public-eligibility/public-eligibility.module';
import { PublicProjectsController } from './controller/public-projects.controller';
import { PublicProjectsRepository } from './repository/public-projects.repository';
import { PublicProjectMetricsRepository } from './repository/public-project-metrics.repository';
import { PublicProjectsService } from './service/public-projects.service';
import { PublicUserProfileController } from './controller/public-user-profile.controller';

@Module({
  imports: [PlatformModule, PublicEligibilityModule],
  controllers: [PublicProjectsController, PublicUserProfileController],
  providers: [
    PublicProjectsRepository,
    PublicProjectMetricsRepository,
    PublicProjectsService,
  ],
})
export class PublicProjectsModule {}

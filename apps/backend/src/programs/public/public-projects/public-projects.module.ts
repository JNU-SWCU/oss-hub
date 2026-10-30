import { Module } from '@nestjs/common';
import { PlatformModule } from '../../../platform/platform.module';
import { PublicEligibilityModule } from '../../../programs/public/public-eligibility/public-eligibility.module';
import { PublicProjectsController } from './controller/public-projects.controller';
import { PublicProjectsRepository } from './repository/public-projects.repository';
import { PublicProjectMetricsRepository } from './repository/public-project-metrics.repository';
import { PublicProjectsService } from './service/public-projects.service';

@Module({
  imports: [PlatformModule, PublicEligibilityModule],
  controllers: [PublicProjectsController],
  providers: [
    PublicProjectsRepository,
    PublicProjectMetricsRepository,
    PublicProjectsService,
  ],
  exports: [PublicProjectsService],
})
export class PublicProjectsModule {}

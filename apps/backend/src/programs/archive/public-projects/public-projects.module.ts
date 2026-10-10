import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PublicEligibilityModule } from '../../../programs/archive/public-eligibility/public-eligibility.module';
import { PublicProjectsController } from './controller/public-projects.controller';
import { PublicProjectsRepository } from './repository/public-projects.repository';
import { PublicProjectMetricsRepository } from './repository/public-project-metrics.repository';
import { PublicProjectsService } from './service/public-projects.service';
import { PublicUserProfileController } from './controller/public-user-profile.controller';

@Module({
  imports: [PrismaModule, PublicEligibilityModule],
  controllers: [PublicProjectsController, PublicUserProfileController],
  providers: [
    PublicProjectsRepository,
    PublicProjectMetricsRepository,
    PublicProjectsService,
  ],
})
export class PublicProjectsModule {}

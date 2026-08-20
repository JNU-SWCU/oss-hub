import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PublicEligibilityModule } from '../../../programs/archive/public-eligibility/public-eligibility.module';
import { PublicProjectsController } from './public-projects.controller';
import { PublicProjectsRepository } from './public-projects.repository';
import { PublicProjectsService } from './public-projects.service';
import { PublicUserProfileController } from './public-user-profile.controller';

/**
 * `GET /projects`, `GET /projects/:projectId`, `GET /users/:userId/public-profile`.
 * Freshness fence and cumulative metrics come from PublicEligibilityModule.
 */
@Module({
  imports: [PrismaModule, PublicEligibilityModule],
  controllers: [PublicProjectsController, PublicUserProfileController],
  providers: [PublicProjectsRepository, PublicProjectsService],
})
export class PublicProjectsModule {}

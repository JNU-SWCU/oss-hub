import { Module } from '@nestjs/common';
import { CollectionModule } from '../../../github/collection.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PublicEligibilityModule } from '../../../programs/archive/public-eligibility/public-eligibility.module';
import { PublicProjectsController } from './public-projects.controller';
import { PublicProjectsRepository } from './public-projects.repository';
import { PublicProjectsService } from './public-projects.service';
import { PublicUserProfileController } from './public-user-profile.controller';

/**
 * todo 16 — `GET /projects`, `GET /projects/:projectId`, `GET /users/:userId/public-profile`.
 * `PublicEligibilityModule`(todo 15)로 freshness fence를, `CollectionModule`로 배치 지표/
 * 기여자 포트를 가져온다. 공개 프로필 경로는 `/users/me/profile`과 겹치지 않으므로
 * `AppModule`의 import 순서와 무관하게 동작한다(#551).
 */
@Module({
  imports: [PrismaModule, PublicEligibilityModule, CollectionModule],
  controllers: [PublicProjectsController, PublicUserProfileController],
  providers: [PublicProjectsRepository, PublicProjectsService],
})
export class PublicProjectsModule {}

import { Module } from '@nestjs/common';
import { CollectionModule } from '../collection/collection.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicEligibilityModule } from '../public-eligibility/public-eligibility.module';
import { PublicProjectsController } from './public-projects.controller';
import { PublicProjectsStore } from './public-projects.store';
import { PublicProjectsService } from './public-projects.service';
import { PublicUserProfileController } from './public-user-profile.controller';

/**
 * todo 16 — `GET /projects`, `GET /projects/:projectId`, `GET /users/:userId/profile`.
 * `PublicEligibilityModule`(todo 15)로 freshness fence를, `CollectionModule`로 배치 지표/
 * 기여자 포트를 가져온다. `AppModule`에서 `UsersModule` 다음에 import해야 `/users/me/profile`
 * 라우트 우선순위가 유지된다.
 */
@Module({
  imports: [PrismaModule, PublicEligibilityModule, CollectionModule],
  controllers: [PublicProjectsController, PublicUserProfileController],
  providers: [PublicProjectsStore, PublicProjectsService],
})
export class PublicProjectsModule {}

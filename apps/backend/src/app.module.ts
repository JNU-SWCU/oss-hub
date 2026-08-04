import { Module } from '@nestjs/common';
import { ApplicationsModule } from './applications/applications.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AuthModule } from './auth/auth.module';
import { CollectionModule } from './collection/collection.module';
import { ConsentsModule } from './consents/consents.module';
import { HealthModule } from './health/health.module';
import { LoginHistoryModule } from './login-history/login-history.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProgramsModule } from './programs/programs.module';
import { PublicProjectsModule } from './public-projects/public-projects.module';
import { RankingModule } from './ranking/ranking.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { RolesModule } from './roles/roles.module';
import { RuntimeConfigModule } from './runtime-config/runtime-config.module';
import { ShowcaseModule } from './showcase/showcase.module';
import { SubmissionReviewsModule } from './submission-reviews/submission-reviews.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { SystemStatusModule } from './system-status/system-status.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    RuntimeConfigModule,
    PrismaModule,
    HealthModule,
    AuditLogModule,
    LoginHistoryModule,
    AuthModule,
    /** ScheduleModule.forRoot() 소유 — Notifications 크론보다 먼저 로드한다. */
    CollectionModule,
    NotificationsModule,
    SystemStatusModule,
    RankingModule,
    ConsentsModule,
    ApplicationsModule,
    RolesModule,
    ProgramsModule,
    SubmissionsModule,
    UsersModule,
    /**
     * todo 16 — `PublicUserProfileController`(`GET /users/:userId/profile`)가 이 모듈에
     * 있다. `/users/me/profile`(위 `UsersModule`, `SessionGuard` 보호)보다 반드시 뒤에
     * import해야 라우트 매칭에서 `me`가 `:userId`로 흡수되지 않는다.
     */
    PublicProjectsModule,
    RepositoriesModule,
    SubmissionReviewsModule,
    ShowcaseModule,
  ],
})
export class AppModule {}

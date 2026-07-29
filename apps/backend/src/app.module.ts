import { Module } from '@nestjs/common';
import { ApplicationsModule } from './applications/applications.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AuthModule } from './auth/auth.module';
import { CollectionModule } from './collection/collection.module';
import { ConsentsModule } from './consents/consents.module';
import { HealthModule } from './health/health.module';
import { LoginHistoryModule } from './login-history/login-history.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProfilesModule } from './profiles/profiles.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProgramsModule } from './programs/programs.module';
import { RankingModule } from './ranking/ranking.module';
import { RepositoryOwnershipModule } from './repository-ownership/repository-ownership.module';
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
    RepositoryOwnershipModule,
    SubmissionsModule,
    UsersModule,
    RepositoriesModule,
    SubmissionReviewsModule,
    ShowcaseModule,
    ProfilesModule,
  ],
})
export class AppModule {}

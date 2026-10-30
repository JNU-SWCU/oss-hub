import { Module } from '@nestjs/common';
import { PlatformModule } from './platform/platform.module';
import { ApplicationsModule } from './applications/applications.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AuthModule } from './auth/auth.module';
import { CollectionModule } from './github/collection.module';
import { MilestoneDocumentsModule } from './milestone-documents/milestone-documents.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProgramsModule } from './programs/programs.module';
import { RankingModule } from './ranking/ranking.module';
import { RepositoriesModule } from './github/repositories.module';
import { SubmissionReviewsModule } from './submission-reviews/submission-reviews.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { SystemStatusModule } from './system-status/system-status.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    PlatformModule,
    AuditLogModule,
    AuthModule,

    CollectionModule,
    NotificationsModule,
    SystemStatusModule,
    RankingModule,
    ApplicationsModule,
    ProgramsModule,
    SubmissionsModule,
    UsersModule,
    RepositoriesModule,
    SubmissionReviewsModule,

    MilestoneDocumentsModule,
  ],
})
export class AppModule {}

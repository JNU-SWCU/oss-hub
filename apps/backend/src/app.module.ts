import { Module } from '@nestjs/common';
import { ApplicationsModule } from './applications/applications.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AuthModule } from './auth/auth.module';
import { BoardModule } from './board/board.module';
import { CollectionModule } from './collection/collection.module';
import { ConsentsModule } from './consents/consents.module';
import { HealthModule } from './health/health.module';
import { LoginHistoryModule } from './login-history/login-history.module';
import { MilestoneDocumentsModule } from './milestone-documents/milestone-documents.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProgramOverviewModule } from './program-overview/program-overview.module';
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
import { TeamInvitationsModule } from './team-invitations/team-invitations.module';
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
    PublicProjectsModule,
    RepositoriesModule,
    SubmissionReviewsModule,
    ShowcaseModule,
    /** #619 프로토타입 정렬 — 마일스톤 서류 항목·게시판·검색 초대형 팀 초대·프로그램 요약. */
    MilestoneDocumentsModule,
    BoardModule,
    TeamInvitationsModule,
    ProgramOverviewModule,
  ],
})
export class AppModule {}

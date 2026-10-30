import { Module } from '@nestjs/common';
import { PlatformModule } from './platform/platform.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AuthModule } from './auth/auth.module';
import { GithubModule } from './github/github.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProgramsModule } from './programs/programs.module';
import { RankingModule } from './ranking/ranking.module';
import { StaffModule } from './staff/staff.module';
import { StudentModule } from './student/student.module';
import { SystemStatusModule } from './system-status/system-status.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    PlatformModule,
    AuditLogModule,
    AuthModule,

    GithubModule,
    NotificationsModule,
    SystemStatusModule,
    RankingModule,
    ProgramsModule,
    StudentModule,
    StaffModule,
    UsersModule,
  ],
})
export class AppModule {}

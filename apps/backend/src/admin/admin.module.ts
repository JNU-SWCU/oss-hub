import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GithubModule } from '../github/github.module';
import { UsersModule } from '../users/users.module';
import { AdminAccessController } from './admin-access.controller';
import { AuditLogController } from './audit-log.controller';
import { CollectionAdminController } from './collection-admin.controller';
import { IndependentAuthorityController } from './independent-authority.controller';
import { MemberKindController } from './member-kind.controller';
import { SystemStatusController } from './system-status.controller';
import { SystemStatusRepository } from './system-status.repository';
import {
  SYSTEM_STATUS_CLOCK,
  SystemStatusService,
} from './system-status.service';

@Module({
  imports: [AuthModule, GithubModule, UsersModule],
  controllers: [
    AdminAccessController,
    IndependentAuthorityController,
    MemberKindController,
    AuditLogController,
    SystemStatusController,
    CollectionAdminController,
  ],
  providers: [
    SystemStatusRepository,
    SystemStatusService,
    { provide: SYSTEM_STATUS_CLOCK, useValue: () => new Date() },
  ],
})
export class AdminModule {}

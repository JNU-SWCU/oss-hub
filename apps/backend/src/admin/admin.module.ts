import { Module } from '@nestjs/common';
import { HttpSecurityModule } from '../platform/http-security.module';
import { GithubModule } from '../github/github.module';
import { UsersModule } from '../users/users.module';
import { UserAccessController } from './user-access.controller';
import { AuditLogController } from './audit-log.controller';
import { CollectionAdminController } from './collection-admin.controller';
import { SystemStatusController } from './system-status.controller';
import { SystemStatusRepository } from './system-status.repository';
import {
  SYSTEM_STATUS_CLOCK,
  SystemStatusService,
} from './system-status.service';

@Module({
  imports: [HttpSecurityModule, GithubModule, UsersModule],
  controllers: [
    UserAccessController,
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

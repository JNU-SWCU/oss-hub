import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditLogController } from './audit-log.controller';
import { AuditLogStore } from './audit-log.store';
import { AuditLogService } from './audit-log.service';

@Module({
  imports: [AuthModule],
  controllers: [AuditLogController],
  providers: [AuditLogStore, AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}

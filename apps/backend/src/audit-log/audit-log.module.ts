import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditLogController } from './controller/audit-log.controller';
import { AuditLogRepository } from './repository/audit-log.repository';
import { AuditLogService } from './service/audit-log.service';

@Module({
  imports: [AuthModule],
  controllers: [AuditLogController],
  providers: [AuditLogRepository, AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}

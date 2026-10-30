import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditLogController } from './controller/audit-log.controller';

@Module({
  imports: [AuthModule],
  controllers: [AuditLogController],
})
export class AuditLogModule {}

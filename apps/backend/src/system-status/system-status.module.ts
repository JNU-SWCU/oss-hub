import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SystemStatusController } from './controller/system-status.controller';
import { SystemStatusRepository } from './repository/system-status.repository';
import {
  SYSTEM_STATUS_CLOCK,
  SystemStatusService,
} from './service/system-status.service';

@Module({
  imports: [AuthModule],
  controllers: [SystemStatusController],
  providers: [
    SystemStatusRepository,
    SystemStatusService,
    { provide: SYSTEM_STATUS_CLOCK, useValue: () => new Date() },
  ],
})
export class SystemStatusModule {}

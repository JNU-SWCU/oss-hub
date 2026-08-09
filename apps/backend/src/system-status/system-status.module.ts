import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CollectionModule } from '../github/collection.module';
import { SystemStatusController } from './system-status.controller';
import { SystemStatusRepository } from './system-status.repository';
import {
  SYSTEM_STATUS_CLOCK,
  SystemStatusService,
} from './system-status.service';

@Module({
  imports: [AuthModule, CollectionModule],
  controllers: [SystemStatusController],
  providers: [
    SystemStatusRepository,
    SystemStatusService,
    { provide: SYSTEM_STATUS_CLOCK, useValue: () => new Date() },
  ],
})
export class SystemStatusModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CollectionModule } from '../github/collection.module';
import { COLLECTION_CRON_EXPRESSION } from '../github/service/collection-scheduler.service';
import { SystemStatusController } from './system-status.controller';
import { SystemStatusRepository } from './system-status.repository';
import {
  SYSTEM_STATUS_CLOCK,
  SYSTEM_STATUS_COLLECTION_CRON_EXPRESSION,
  SystemStatusService,
} from './system-status.service';

@Module({
  imports: [AuthModule, CollectionModule],
  controllers: [SystemStatusController],
  providers: [
    SystemStatusRepository,
    SystemStatusService,
    { provide: SYSTEM_STATUS_CLOCK, useValue: () => new Date() },
    {
      provide: SYSTEM_STATUS_COLLECTION_CRON_EXPRESSION,
      useValue: COLLECTION_CRON_EXPRESSION,
    },
  ],
})
export class SystemStatusModule {}

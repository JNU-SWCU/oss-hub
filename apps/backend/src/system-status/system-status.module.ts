import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CollectionModule } from '../collection/collection.module';
import { SystemStatusController } from './system-status.controller';
import { SystemStatusStore } from './system-status.store';
import {
  SYSTEM_STATUS_CLOCK,
  SystemStatusService,
} from './system-status.service';

@Module({
  imports: [AuthModule, CollectionModule],
  controllers: [SystemStatusController],
  providers: [
    SystemStatusStore,
    SystemStatusService,
    { provide: SYSTEM_STATUS_CLOCK, useValue: () => new Date() },
  ],
})
export class SystemStatusModule {}

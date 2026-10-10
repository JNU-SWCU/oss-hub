import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { CollectionCutoverRepository } from './repository/collection-cutover.repository';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { CollectionAdminController } from './controller/collection-admin.controller';
import { ContributionInvariants } from './repository/contribution-invariants';
import { CollectionAdminService } from './service/collection-admin.service';
import { UsersModule } from '../users/users.module';
import { CollectionReadService } from './repository/collection-read.service';
import { CollectionScheduler } from './job/collection.scheduler';
import { CollectionTriggerService } from './service/collection-trigger.service';
import { CollectionUserActivityRepository } from './repository/collection-user-activity.repository';
import { collectionProviders } from './service/collection.providers';

@Module({
  imports: [ScheduleModule.forRoot(), AuditLogModule, AuthModule, UsersModule],
  controllers: [CollectionAdminController],
  providers: [
    CollectionAdminService,
    ContributionInvariants,
    CollectionScheduler,
    CollectionTriggerService,
    CollectionIncrementalRepository,
    CollectionCutoverRepository,
    CollectionUserActivityRepository,
    CollectionReadService,
    ...collectionProviders,
  ],
  exports: [CollectionTriggerService],
})
export class CollectionModule {}

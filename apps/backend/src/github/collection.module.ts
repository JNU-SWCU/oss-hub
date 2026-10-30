import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { CollectionCutoverRepository } from './repository/collection-cutover.repository';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { CollectionAdminController } from './controller/collection-admin.controller';
import { CollectionAdminService } from './service/collection-admin.service';
import { UsersModule } from '../users/users.module';
import { CollectionScheduler } from './job/collection.scheduler';
import { CollectionTriggerService } from './service/collection-trigger.service';
import { CollectionUserActivityRepository } from './repository/collection-user-activity.repository';
import { collectionProviders } from './service/collection.providers';

@Module({
  imports: [ScheduleModule.forRoot(), PlatformModule, AuthModule, UsersModule],
  controllers: [CollectionAdminController],
  providers: [
    CollectionAdminService,
    CollectionScheduler,
    CollectionTriggerService,
    CollectionIncrementalRepository,
    CollectionCutoverRepository,
    CollectionUserActivityRepository,
    ...collectionProviders,
  ],
  exports: [CollectionTriggerService],
})
export class CollectionModule {}

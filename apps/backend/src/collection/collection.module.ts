import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { CollectionAdminController } from './collection-admin.controller';
import { CollectionAdminGuard } from './collection-admin.guard';
import { CollectionConfig } from './collection.config';
import { CollectionController } from './collection.controller';
import { CollectionRepository } from './collection.repository';
import { CollectionRunStarter } from './collection-run-starter.service';
import { CollectionSchedulerService } from './collection-scheduler.service';
import { CollectionService } from './collection.service';
import { GithubApiClient } from './github-api.client';

@Module({
  imports: [ScheduleModule.forRoot(), AuthModule],
  controllers: [CollectionController, CollectionAdminController],
  providers: [
    CollectionConfig,
    CollectionAdminGuard,
    CollectionRepository,
    CollectionRunStarter,
    CollectionSchedulerService,
    CollectionService,
    {
      provide: GithubApiClient,
      inject: [CollectionConfig],
      useFactory: (config: CollectionConfig): GithubApiClient =>
        new GithubApiClient(() => config.requireCredentials()),
    },
  ],
  exports: [CollectionConfig, CollectionService],
})
export class CollectionModule {}

import { Module } from '@nestjs/common';
import { CollectionProvidersService } from './collection-providers.service';
import { CollectionUserActivityRepository } from './repository-provision-job.repository';
import { CollectionUserActivityService } from './collection-user-activity.service';

@Module({
  providers: [
    CollectionUserActivityRepository,
    ...CollectionProvidersService.activityProviders,
  ],
  exports: [CollectionUserActivityService],
})
export class CollectionUserActivityModule {}

import { Module } from '@nestjs/common';
import { COLLECTION_ACTIVITY_PROVIDERS } from './collection-public-token.service';
import { CollectionUserActivityRepository } from './repository-provision-job.repository';
import { CollectionUserActivityService } from './collection-user-activity.service';

@Module({
  providers: [
    CollectionUserActivityRepository,
    ...COLLECTION_ACTIVITY_PROVIDERS,
  ],
  exports: [CollectionUserActivityService],
})
export class CollectionUserActivityModule {}

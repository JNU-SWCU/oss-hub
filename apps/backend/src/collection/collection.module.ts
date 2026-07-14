import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CollectionConfig } from './collection.config';
import { CollectionController } from './collection.controller';
import { CollectionRepository } from './collection.repository';
import { CollectionService } from './collection.service';
import { GithubApiClient } from './github-api.client';

@Module({
  imports: [AuthModule],
  controllers: [CollectionController],
  providers: [
    CollectionConfig,
    CollectionRepository,
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

import { Module } from '@nestjs/common';
import { CollectionModule } from '../collection/collection.module';
import { RepositoryOwnershipModule } from '../repository-ownership/repository-ownership.module';
import { RankingController } from './ranking.controller';
import { RankingService } from './ranking.service';

@Module({
  imports: [CollectionModule, RepositoryOwnershipModule],
  controllers: [RankingController],
  providers: [RankingService],
})
export class RankingModule {}

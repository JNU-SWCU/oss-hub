import { Module } from '@nestjs/common';
import { CollectionModule } from '../collection/collection.module';
import { PublicProjectsModule } from '../public-projects/public-projects.module';
import { RepositoryOwnershipModule } from '../repository-ownership/repository-ownership.module';
import { RankingController } from './ranking.controller';
import { RankingUserEligibilityRepository } from './ranking-user-eligibility.repository';
import { RankingService } from './ranking.service';

@Module({
  imports: [CollectionModule, PublicProjectsModule, RepositoryOwnershipModule],
  controllers: [RankingController],
  providers: [RankingService, RankingUserEligibilityRepository],
})
export class RankingModule {}

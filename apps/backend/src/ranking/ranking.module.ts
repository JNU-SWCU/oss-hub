import { Module } from '@nestjs/common';
import { RepositoryOwnershipModule } from '../repository-ownership/repository-ownership.module';
import { RankingController } from './ranking.controller';
import { RankingRepository } from './ranking.repository';
import { RankingService } from './ranking.service';

@Module({
  imports: [RepositoryOwnershipModule],
  controllers: [RankingController],
  providers: [RankingRepository, RankingService],
})
export class RankingModule {}

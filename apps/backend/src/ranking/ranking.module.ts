import { Module } from '@nestjs/common';
import { RankingController } from './ranking.controller';
import { RankingRepository } from './ranking.repository';
import { RankingService } from './ranking.service';

@Module({
  controllers: [RankingController],
  providers: [RankingRepository, RankingService],
})
export class RankingModule {}

import { Module } from '@nestjs/common';
import { RankingController } from './ranking.controller';
import { RankingRepository } from './ranking.repository';
import { RankingService } from './ranking.service';
import { RankingYearService } from './ranking-year.service';

@Module({
  controllers: [RankingController],
  providers: [RankingService, RankingRepository, RankingYearService],
  exports: [RankingService, RankingYearService],
})
export class RankingModule {}

import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { RankingController } from './ranking.controller';
import { RankingRepository } from './ranking.repository';
import { RankingService } from './ranking.service';
import { RankingTimelineService } from './ranking-timeline.service';
import { RankingYearService } from './ranking-year.service';

@Module({
  imports: [GithubModule],
  controllers: [RankingController],
  providers: [
    RankingService,
    RankingRepository,
    RankingTimelineService,
    RankingYearService,
  ],
  exports: [RankingService, RankingYearService],
})
export class RankingModule {}

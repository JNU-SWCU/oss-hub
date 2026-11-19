import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { RankingAllTimelineRepository } from './ranking-all-timeline.repository';
import { RankingController } from './ranking.controller';
import { RankingRepository } from './ranking.repository';
import { RankingStreakRepository } from './ranking-streak.repository';
import { RankingService } from './ranking.service';
import { RankingTimelineService } from './ranking-timeline.service';
import { RankingYearService } from './ranking-year.service';

@Module({
  imports: [GithubModule],
  controllers: [RankingController],
  providers: [
    RankingService,
    RankingRepository,
    RankingAllTimelineRepository,
    RankingStreakRepository,
    RankingTimelineService,
    RankingYearService,
  ],
  exports: [RankingService, RankingYearService],
})
export class RankingModule {}

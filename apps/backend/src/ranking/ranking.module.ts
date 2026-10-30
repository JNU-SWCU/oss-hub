import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RankingController } from './ranking.controller';
import { RankingRepository } from './ranking.repository';
import { RankingService } from './ranking.service';

@Module({
  imports: [AuthModule],
  controllers: [RankingController],
  providers: [RankingService, RankingRepository],
  exports: [RankingService],
})
export class RankingModule {}

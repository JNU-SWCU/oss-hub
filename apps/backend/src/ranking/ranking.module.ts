import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RankingController } from './controller/ranking.controller';
import { RankingRepository } from './repository/ranking.repository';
import { RankingService } from './service/ranking.service';

@Module({
  imports: [AuthModule],
  controllers: [RankingController],
  providers: [RankingService, RankingRepository],
  exports: [RankingService],
})
export class RankingModule {}

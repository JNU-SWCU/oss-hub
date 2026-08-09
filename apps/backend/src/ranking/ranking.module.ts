import { Module } from '@nestjs/common';
import { CollectionModule } from '../github/collection.module';
import { UsersModule } from '../users/users.module';
import { RankingController } from './controller/ranking.controller';
import { RankingService } from './service/ranking.service';

@Module({
  imports: [CollectionModule, UsersModule],
  controllers: [RankingController],
  providers: [RankingService],
})
export class RankingModule {}

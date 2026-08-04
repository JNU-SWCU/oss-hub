import { Module } from '@nestjs/common';
import { CollectionModule } from '../collection/collection.module';
import { UsersModule } from '../users/users.module';
import { RankingController } from './ranking.controller';
import { RankingService } from './ranking.service';

@Module({
  imports: [CollectionModule, UsersModule],
  controllers: [RankingController],
  providers: [RankingService],
})
export class RankingModule {}

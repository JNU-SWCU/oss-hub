import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CollectionModule } from '../github/collection.module';
import { UsersModule } from '../users/users.module';
import { RankingController } from './controller/ranking.controller';
import { RankingViewerRepository } from './repository/ranking-viewer.repository';
import { RankingService } from './service/ranking.service';

@Module({
  // `AuthModule` 은 `AuthConfig` 하나 때문에 들인다 — controller 가 세션 쿠키를
  // optional 로 해석하는 데만 쓴다. 인증 가드는 붙이지 않는다(비로그인 200 유지).
  imports: [AuthModule, CollectionModule, UsersModule],
  controllers: [RankingController],
  providers: [RankingViewerRepository, RankingService],
})
export class RankingModule {}

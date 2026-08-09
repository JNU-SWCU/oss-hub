import { Module } from '@nestjs/common';
import { CollectionModule } from '../../../github/collection.module';
import { PublicEligibilityService } from './public-eligibility.service';

/**
 * todo 15 — 아직 어떤 controller도 소비하지 않는다(todo 16이 list/detail/profile/ranking
 * 소비자를 배선할 때 이 모듈을 import한다). `CollectionModule`만 가져와
 * `COLLECTION_READ_PORT`를 주입한다.
 */
@Module({
  imports: [CollectionModule],
  providers: [PublicEligibilityService],
  exports: [PublicEligibilityService],
})
export class PublicEligibilityModule {}

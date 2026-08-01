import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShowcaseProjectionRepository } from './showcase-projection.repository';
import { ShowcaseProjectionService } from './showcase-projection.service';

/**
 * todo 16 — 공개 읽기 컨트롤러(`ShowcasePublicController`/`ShowcasePublicService`)는
 * `public-projects` 모듈로 이전되었다(구 `GET /repositories/public`·`/repositories/:id/public`
 * 은 404). writer(`ShowcaseProjectionRepository`/`ShowcaseProjectionService`)는 todo 20까지
 * 구버전 호환을 위해 그대로 남는다 — `RepositoriesModule`이 이 export를 그대로 소비한다.
 */
@Module({
  imports: [PrismaModule],
  providers: [ShowcaseProjectionRepository, ShowcaseProjectionService],
  exports: [ShowcaseProjectionService],
})
export class ShowcaseModule {}

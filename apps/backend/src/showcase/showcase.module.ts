import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShowcaseProjectionRepository } from './showcase-projection.repository';
import { ShowcaseProjectionService } from './showcase-projection.service';

/**
 * todo 16 — 공개 읽기 컨트롤러(`ShowcasePublicController`/`ShowcasePublicService`)는
 * `public-projects` 모듈로 이전되었다(구 `GET /repositories/public`·`/repositories/:id/public`
 * 은 404). todo 20 — 마지막 writer 호출(`RepositoriesService.publish`의
 * `ShowcaseProjectionService.projectRepository` 소비)도 제거되어 이 테이블은 완전히
 * read-only가 되었다. 모듈/테이블 자체의 삭제는 Issue #463에서 다룬다 — 그때까지는
 * `app.module.ts`에만 등록된 채로 남는다(더 이상 어떤 모듈도 writer를 주입받지 않는다).
 */
@Module({
  imports: [PrismaModule],
  providers: [ShowcaseProjectionRepository, ShowcaseProjectionService],
  exports: [ShowcaseProjectionService],
})
export class ShowcaseModule {}

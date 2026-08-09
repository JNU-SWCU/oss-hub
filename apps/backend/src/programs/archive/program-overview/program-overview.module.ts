import { Module } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';
import { ProgramOverviewController } from './program-overview.controller';
import { ProgramOverviewRepository } from './program-overview.repository';
import { ProgramOverviewService } from './program-overview.service';

/**
 * 프로그램 상세 화면 상단 요약(마일스톤/게시글 개수 등) 모듈. 단일 조회 endpoint만
 * 갖춘 최소 skeleton — 팀 로스터·다가오는 마일스톤 카드 등은 이 모듈을 확장할
 * 다른 lane 소관이다. programs 모듈의 기존 컨트롤러/서비스/리포지토리는 건드리지 않는다.
 */
@Module({
  imports: [AuthModule],
  controllers: [ProgramOverviewController],
  providers: [ProgramOverviewService, ProgramOverviewRepository],
  exports: [ProgramOverviewService],
})
export class ProgramOverviewModule {}

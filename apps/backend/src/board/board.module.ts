import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardAccessGuard } from './board-access.guard';
import { BoardController } from './board.controller';
import { BoardRepository } from './board.repository';
import { BoardService } from './board.service';

/**
 * 프로그램 게시판(BoardPost/BoardComment) 모듈 — 목록(페이지네이션·고정글 우선)·
 * 상세·작성·수정·삭제와 댓글 작성·삭제, 교직원 전용 고정을 제공한다(#619).
 * 접근은 해당 프로그램 참여자(승인된 신청자)와 교직원으로 제한한다(BoardAccessGuard).
 */
@Module({
  imports: [AuthModule],
  controllers: [BoardController],
  providers: [BoardService, BoardRepository, BoardAccessGuard],
  exports: [BoardService],
})
export class BoardModule {}

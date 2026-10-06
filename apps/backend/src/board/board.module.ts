import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardAccessGuard } from './board-access.guard';
import { BoardController } from './board.controller';
import { BoardRepository } from './board.repository';
import { BoardService } from './board.service';

@Module({
  imports: [AuthModule],
  controllers: [BoardController],
  providers: [BoardService, BoardRepository, BoardAccessGuard],
  exports: [BoardService],
})
export class BoardModule {}

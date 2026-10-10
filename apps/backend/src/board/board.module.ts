import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { BoardController } from './controller/board.controller';
import { BoardRepository } from './repository/board.repository';
import { BoardService } from './service/board.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [BoardController],
  providers: [BoardService, BoardRepository],
  exports: [BoardService],
})
export class BoardModule {}

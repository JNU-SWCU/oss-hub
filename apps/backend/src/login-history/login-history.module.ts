import { Module } from '@nestjs/common';
import { LoginHistoryRepository } from './repository/login-history.repository';
import { LoginHistoryService } from './service/login-history.service';

@Module({
  providers: [LoginHistoryRepository, LoginHistoryService],
  exports: [LoginHistoryService],
})
export class LoginHistoryModule {}

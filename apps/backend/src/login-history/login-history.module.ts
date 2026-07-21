import { Module } from '@nestjs/common';
import { LoginHistoryRepository } from './login-history.repository';
import { LoginHistoryService } from './login-history.service';

@Module({
  providers: [LoginHistoryRepository, LoginHistoryService],
  exports: [LoginHistoryService],
})
export class LoginHistoryModule {}

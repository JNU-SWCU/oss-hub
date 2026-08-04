import { Module } from '@nestjs/common';
import { LoginHistoryStore } from './login-history.store';
import { LoginHistoryService } from './login-history.service';

@Module({
  providers: [LoginHistoryStore, LoginHistoryService],
  exports: [LoginHistoryService],
})
export class LoginHistoryModule {}

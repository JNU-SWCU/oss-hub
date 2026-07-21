import { Module } from '@nestjs/common';
import { LoginHistoryController } from '../login-history/login-history.controller';
import { LoginHistoryModule } from '../login-history/login-history.module';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { OriginGuard } from './origin.guard';
import { SessionGuard } from './session.guard';

@Module({
  imports: [LoginHistoryModule],
  controllers: [AuthController, LoginHistoryController],
  providers: [
    AuthConfig,
    AuthService,
    AuthRepository,
    SessionGuard,
    OriginGuard,
  ],
  exports: [AuthConfig, SessionGuard, OriginGuard],
})
export class AuthModule {}

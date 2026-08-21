import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoginHistoryController } from '../login-history/login-history.controller';
import { LoginHistoryModule } from '../login-history/login-history.module';
import { AuthenticationGuard } from './authentication.guard';
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
    AuthenticationGuard,
    { provide: APP_GUARD, useExisting: AuthenticationGuard },
    SessionGuard,
    OriginGuard,
  ],
  exports: [AuthConfig, AuthService, SessionGuard, OriginGuard],
})
export class AuthModule {}

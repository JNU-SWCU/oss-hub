import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoginHistoryController } from '../login-history/login-history.controller';
import { LoginHistoryModule } from '../login-history/login-history.module';
import { AuthenticationGuard } from './controller/authentication.guard';
import { AuthConfig } from './auth.config';
import { AuthController } from './controller/auth.controller';
import { AuthRepository } from './repository/auth.repository';
import { AuthService } from './service/auth.service';
import { OriginGuard } from './controller/origin.guard';
import { SessionGuard } from './controller/session.guard';

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

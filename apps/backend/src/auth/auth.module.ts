import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoginHistoryController } from './login-history.controller';
import { LoginHistoryRepository, AuthRepository } from './auth.repository';
import { LoginHistoryService, AuthService } from './auth.service';
import { AuthenticationGuard } from './authentication.guard';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { OriginGuard } from './origin.guard';
import { SessionGuard } from './session.guard';
import { AuthSessionService } from './auth-session.service';
import { CollectionUserActivityModule } from '../github/collection-user-activity.module';

@Module({
  imports: [CollectionUserActivityModule],
  controllers: [AuthController, LoginHistoryController],
  providers: [
    AuthConfig,
    AuthSessionService,
    AuthService,
    AuthRepository,
    LoginHistoryRepository,
    LoginHistoryService,
    AuthenticationGuard,
    { provide: APP_GUARD, useExisting: AuthenticationGuard },
    SessionGuard,
    OriginGuard,
  ],
  exports: [
    AuthConfig,
    AuthSessionService,
    AuthService,
    SessionGuard,
    OriginGuard,
  ],
})
export class AuthModule {}

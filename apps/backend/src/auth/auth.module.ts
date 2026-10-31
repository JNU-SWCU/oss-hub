import { Module } from '@nestjs/common';
import { HttpSecurityModule } from '../platform/http-security.module';
import { UsersModule } from '../users/users.module';
import { APP_GUARD } from '@nestjs/core';
import { LoginHistoryController } from './login-history.controller';
import { LoginHistoryRepository, AuthRepository } from './auth.repository';
import { LoginHistoryService, AuthService } from './auth.service';
import { AuthenticationGuard } from './authentication.guard';
import { AuthController } from './auth.controller';
import { CollectionUserActivityModule } from '../github/collection-user-activity.module';

@Module({
  imports: [HttpSecurityModule, UsersModule, CollectionUserActivityModule],
  controllers: [AuthController, LoginHistoryController],
  providers: [
    AuthService,
    AuthRepository,
    LoginHistoryRepository,
    LoginHistoryService,
    AuthenticationGuard,
    { provide: APP_GUARD, useExisting: AuthenticationGuard },
  ],
})
export class AuthModule {}

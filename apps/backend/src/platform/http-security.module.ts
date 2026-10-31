import { Module } from '@nestjs/common';
import { AuthConfig } from './auth.config';
import { AuthSessionService } from './auth-session.service';
import { OriginGuard } from './origin.guard';

@Module({
  providers: [AuthConfig, AuthSessionService, OriginGuard],
  exports: [AuthConfig, AuthSessionService, OriginGuard],
})
export class HttpSecurityModule {}

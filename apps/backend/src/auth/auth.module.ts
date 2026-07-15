import { Module } from '@nestjs/common';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { OriginGuard } from './origin.guard';
import { SessionGuard } from './session.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthConfig, AuthService, AuthRepository, SessionGuard, OriginGuard],
  exports: [AuthConfig, SessionGuard, OriginGuard],
})
export class AuthModule {}

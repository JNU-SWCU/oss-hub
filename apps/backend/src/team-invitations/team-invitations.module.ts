import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AuthModule } from '../auth/auth.module';
import { TeamInvitationsController } from './controller/team-invitations.controller';
import { TeamInvitationsRepository } from './repository/team-invitations.repository';
import { TeamInvitationsService } from './service/team-invitations.service';

@Module({
  imports: [AuthModule, PlatformModule],
  controllers: [TeamInvitationsController],
  providers: [TeamInvitationsService, TeamInvitationsRepository],
  exports: [TeamInvitationsService],
})
export class TeamInvitationsModule {}

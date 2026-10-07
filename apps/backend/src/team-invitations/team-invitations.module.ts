import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { TeamInvitationsController } from './team-invitations.controller';
import { TeamInvitationsRepository } from './team-invitations.repository';
import { TeamInvitationsService } from './team-invitations.service';

@Module({
  imports: [AuthModule, AuditLogModule],
  controllers: [TeamInvitationsController],
  providers: [TeamInvitationsService, TeamInvitationsRepository],
  exports: [TeamInvitationsService],
})
export class TeamInvitationsModule {}

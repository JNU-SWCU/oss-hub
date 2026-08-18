import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { TeamInvitationsController } from './team-invitations.controller';
import { TeamInvitationsRepository } from './team-invitations.repository';
import { TeamInvitationsService } from './team-invitations.service';

/**
 * 검색·초대형 팀 초대(TeamInvitation) 모듈. 본인이 받은 초대 목록 조회만 갖춘
 * 최소 skeleton — 검색·초대 발송·수락/거절 endpoint는 이 모듈을 채울 다른 lane 소관이다.
 * 기존 join-code(joinCodeDigest) 초대 경로(programs 모듈)는 건드리지 않는다.
 */
@Module({
  imports: [AuthModule, AuditLogModule],
  controllers: [TeamInvitationsController],
  providers: [TeamInvitationsService, TeamInvitationsRepository],
  exports: [TeamInvitationsService],
})
export class TeamInvitationsModule {}

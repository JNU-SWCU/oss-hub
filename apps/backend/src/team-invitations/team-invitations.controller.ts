import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { AcceptTeamInvitationResponseDto } from './dto/accept-team-invitation-response.dto';
import { CreateTeamInvitationRequestDto } from './dto/create-team-invitation-request.dto';
import { InvitationCandidateResponseDto } from './dto/invitation-candidate-response.dto';
import { ReceivedTeamInvitationResponseDto } from './dto/received-team-invitation-response.dto';
import { SearchInvitationCandidatesRequestDto } from './dto/search-invitation-candidates-request.dto';
import { TeamInvitationResponseDto } from './dto/team-invitation-response.dto';
import { TeamInvitationsService } from './team-invitations.service';

@Controller('team-invitations')
@UseGuards(SessionGuard)
export class TeamInvitationsController {
  constructor(private readonly service: TeamInvitationsService) {}

  @Get('received')
  async listReceived(
    @Req() request: AuthenticatedRequest,
  ): Promise<ReceivedTeamInvitationResponseDto[]> {
    const invitations = await this.service.listReceived(
      request.sessionGithubId,
    );
    return invitations.map((invitation) =>
      ReceivedTeamInvitationResponseDto.from(invitation),
    );
  }

  @Get('teams/:teamId/sent')
  async listSentByTeam(
    @Req() request: AuthenticatedRequest,
    @Param('teamId') teamId: string,
  ): Promise<TeamInvitationResponseDto[]> {
    const invitations = await this.service.listSentByTeam(
      request.sessionGithubId,
      teamId,
    );
    return invitations.map((invitation) =>
      TeamInvitationResponseDto.from(invitation),
    );
  }

  @Get('teams/:teamId/search')
  async search(
    @Req() request: AuthenticatedRequest,
    @Param('teamId') teamId: string,
    @Query() query: SearchInvitationCandidatesRequestDto,
  ): Promise<InvitationCandidateResponseDto[]> {
    const candidates = await this.service.searchCandidates(
      request.sessionGithubId,
      teamId,
      query.query,
    );
    return candidates.map((candidate) =>
      InvitationCandidateResponseDto.from(candidate),
    );
  }

  @Post('teams/:teamId/invitations')
  @HttpCode(201)
  @UseGuards(OriginGuard)
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('teamId') teamId: string,
    @Body() body: CreateTeamInvitationRequestDto,
  ): Promise<TeamInvitationResponseDto> {
    const invitation = await this.service.create(
      request.sessionGithubId,
      teamId,
      body.inviteeUserId,
    );
    return TeamInvitationResponseDto.from(invitation);
  }

  @Post(':invitationId/cancel')
  @HttpCode(204)
  @UseGuards(OriginGuard)
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    await this.service.cancel(request.sessionGithubId, invitationId);
  }

  @Post(':invitationId/decline')
  @HttpCode(204)
  @UseGuards(OriginGuard)
  async decline(
    @Req() request: AuthenticatedRequest,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    await this.service.decline(request.sessionGithubId, invitationId);
  }

  @Post(':invitationId/accept')
  @HttpCode(200)
  @UseGuards(OriginGuard)
  async accept(
    @Req() request: AuthenticatedRequest,
    @Param('invitationId') invitationId: string,
  ): Promise<AcceptTeamInvitationResponseDto> {
    const result = await this.service.accept(
      request.sessionGithubId,
      invitationId,
    );
    return AcceptTeamInvitationResponseDto.from(result);
  }
}

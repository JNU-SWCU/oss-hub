import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { CreateTeamRequestDto } from './dto/create-team-request.dto';
import { JoinTeamRequestDto } from './dto/join-team-request.dto';
import {
  CreateTeamResponseDto,
  ProgramTeamResponseDto,
} from './dto/team-response.dto';
import { ProgramTeamsService } from './program-teams.service';

type TeamSessionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

/**
 * 팀 생성·합류·내 팀 조회 — ProgramsController 와 분리된 thin sibling.
 * POST /api/v1/programs/:programId/teams
 * POST /api/v1/programs/:programId/teams/join
 * GET  /api/v1/programs/:programId/teams/me
 */
@Controller('programs/:programId/teams')
export class ProgramTeamsController {
  constructor(
    @Inject(ProgramTeamsService)
    private readonly service: Pick<
      ProgramTeamsService,
      'create' | 'join' | 'getMe'
    >,
  ) {}

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  async create(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Body() body: CreateTeamRequestDto,
  ): Promise<CreateTeamResponseDto> {
    const team = await this.service.create(
      request.sessionGithubId,
      programId,
      body.name,
    );
    return CreateTeamResponseDto.from(team);
  }

  @Post('join')
  @HttpCode(200)
  @UseGuards(SessionGuard, OriginGuard)
  async join(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Body() body: JoinTeamRequestDto,
  ): Promise<ProgramTeamResponseDto> {
    const team = await this.service.join(
      request.sessionGithubId,
      programId,
      body.joinCode,
    );
    return ProgramTeamResponseDto.from(team);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  async me(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
  ): Promise<ProgramTeamResponseDto> {
    const team = await this.service.getMe(request.sessionGithubId, programId);
    return ProgramTeamResponseDto.from(team);
  }
}

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
import { OriginGuard } from '../../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../../auth/session.guard';
import { CreateTeamRequestDto } from '../dto/create-team-request.dto';
import { JoinTeamRequestDto } from '../dto/join-team-request.dto';
import {
  CreateTeamResponseDto,
  ProgramTeamResponseDto,
  StaffProgramTeamResponseDto,
} from '../dto/team-response.dto';
import { ProgramTeamsStaffGuard } from '../program-teams-staff.guard';
import { ProgramTeamsService } from '../service/program-teams.service';

type TeamSessionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

/**
 * 팀 생성·합류·내 팀 조회·교직원 팀 목록 — ProgramsController 와 분리된 thin sibling.
 * POST /api/v1/programs/:programId/teams
 * POST /api/v1/programs/:programId/teams/join
 * GET  /api/v1/programs/:programId/teams/me
 * GET  /api/v1/programs/:programId/teams        (교직원 전용)
 */
@Controller('programs/:programId/teams')
export class ProgramTeamsController {
  constructor(
    @Inject(ProgramTeamsService)
    private readonly service: Pick<
      ProgramTeamsService,
      'create' | 'join' | 'getMe' | 'listForStaff'
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

  /**
   * 교직원 전용 팀 목록 — 팀원 전원의 실명을 포함한다.
   * 정적 형제 우선 규칙(`programs.controller.ts` 주석)에 따라 `GET me` 뒤에 선언한다.
   * 학생도 쓰는 공개 로스터는 `GET /programs/:id/overview/teams` 로 그대로 남는다.
   */
  @Get()
  @UseGuards(SessionGuard, ProgramTeamsStaffGuard)
  async list(
    @Param('programId') programId: string,
  ): Promise<StaffProgramTeamResponseDto[]> {
    return StaffProgramTeamResponseDto.fromAll(
      await this.service.listForStaff(programId),
    );
  }
}

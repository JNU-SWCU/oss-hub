import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../../auth/origin.guard';
import {
  type AuthenticatedRequest,
  SessionGuard,
} from '../../auth/session.guard';
import { CreateTeamRequestDto } from '../dto/create-team-request.dto';
import { JoinTeamRequestDto } from '../dto/join-team-request.dto';
import { StaffTeamDetailResponseDto } from '../dto/team-detail-response.dto';
import {
  CreateTeamResponseDto,
  ProgramTeamResponseDto,
  StaffProgramTeamResponseDto,
} from '../dto/team-response.dto';
import { ProgramTeamsStaffGuard } from '../program-teams-staff.guard';
import { ProgramTeamsService } from '../service/program-teams.service';

type TeamSessionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

/**
 * 팀 생성·합류·내 팀 조회·교직원 팀 목록/상세 — ProgramsController 와 분리된 thin sibling.
 * POST /api/v1/programs/:programId/teams
 * POST /api/v1/programs/:programId/teams/join
 * GET  /api/v1/programs/:programId/teams/me
 * GET  /api/v1/programs/:programId/teams          (교직원 전용)
 * GET  /api/v1/programs/:programId/teams/:teamId  (교직원 전용)
 */
@Controller('programs/:programId/teams')
export class ProgramTeamsController {
  constructor(
    @Inject(ProgramTeamsService)
    private readonly service: Pick<
      ProgramTeamsService,
      'create' | 'join' | 'getMe' | 'listForStaff' | 'getForStaff'
    > &
      Partial<Pick<ProgramTeamsService, 'leave'>>,
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

  @Delete('me')
  @HttpCode(204)
  @UseGuards(SessionGuard, OriginGuard)
  async leave(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
  ): Promise<void> {
    await this.service.leave?.(request.sessionGithubId, programId);
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

  /**
   * 교직원 전용 팀 상세(#874) — 팀원·신청 상태·저장소 발급 상태를 한 요청으로 담는다.
   * 동적 세그먼트라 위의 정적 형제(`join`, `me`, 빈 경로)보다 뒤에 선언한다
   * (`programs.controller.ts` 정적 형제 우선 규칙과 동일).
   * 없는 팀·다른 프로그램의 팀은 동일하게 404.
   */
  @Get(':teamId')
  @UseGuards(SessionGuard, ProgramTeamsStaffGuard)
  async detail(
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
  ): Promise<StaffTeamDetailResponseDto> {
    return StaffTeamDetailResponseDto.from(
      await this.service.getForStaff(programId, teamId),
    );
  }
}

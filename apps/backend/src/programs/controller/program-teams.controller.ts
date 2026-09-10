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
 * 팀 생성·내 팀 조회·교직원 팀 목록/상세 — ProgramsController 와 분리된 thin sibling.
 * 팀 합류는 초대 수락(`team-invitations`) 단독 경로다 — 참여코드로 합류하는
 * `POST teams/join` 은 초대 전용 규칙을 우회해서 제거했고 대체 경로도 두지 않는다.
 * POST   /api/v1/programs/:programId/teams
 * GET    /api/v1/programs/:programId/teams/me
 * DELETE /api/v1/programs/:programId/teams/me                  (본인 탈퇴)
 * DELETE /api/v1/programs/:programId/teams/me/members/:userId  (팀장의 팀원 제외)
 * GET    /api/v1/programs/:programId/teams          (교직원 전용)
 * GET    /api/v1/programs/:programId/teams/:teamId  (교직원 전용)
 */
@Controller('programs/:programId/teams')
export class ProgramTeamsController {
  constructor(
    @Inject(ProgramTeamsService)
    private readonly service: Pick<
      ProgramTeamsService,
      | 'create'
      | 'getMe'
      | 'leave'
      | 'removeMember'
      | 'listForStaff'
      | 'getForStaff'
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
    await this.service.leave(request.sessionGithubId, programId);
  }

  /**
   * 팀장이 다른 팀원을 제외한다 — 행위자는 세션(`me`), 대상은 `:userId` 다.
   * `me/members/:userId` 는 정적 `me` 아래라 교직원 동적 경로(`:teamId`)보다 먼저
   * 선언해야 가로채이지 않는다. 권한(팀장 여부)·마지막 팀원 규칙은 service 가 판정한다.
   */
  @Delete('me/members/:userId')
  @HttpCode(204)
  @UseGuards(SessionGuard, OriginGuard)
  async removeMember(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.service.removeMember(request.sessionGithubId, programId, userId);
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
   * 동적 세그먼트라 위의 정적 형제(`me`, 빈 경로)보다 뒤에 선언한다
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

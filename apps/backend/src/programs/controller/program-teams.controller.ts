import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../../auth/origin.guard';
import {
  type AuthenticatedRequest,
  SessionGuard,
} from '../../auth/session.guard';
import { CreateTeamRequestDto } from '../dto/create-team-request.dto';
import { DeleteTeamRequestDto } from '../dto/delete-team-request.dto';
import { RenameTeamRequestDto } from '../dto/rename-team-request.dto';
import { TransferTeamLeaderRequestDto } from '../dto/transfer-team-leader-request.dto';
import {
  StaffTeamDetailResponseDto,
  RepositoryUrlHistoryResponseDto,
} from '../dto/team-detail-response.dto';
import { RepositoryUrlHistoryQueryRequestDto } from '../dto/repository-url-history-query.dto';
import {
  CreateTeamResponseDto,
  DeleteTeamResponseDto,
  ProgramTeamResponseDto,
  RenameTeamResponseDto,
  StaffProgramTeamResponseDto,
} from '../dto/team-response.dto';
import { ProgramTeamsStaffGuard } from '../program-teams-staff.guard';
import { ProgramTeamsService } from '../service/program-teams.service';

type TeamSessionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

/**
 * 팀 생성·내 팀 조회·교직원 팀 목록/상세/저장소 URL 이력 — ProgramsController 와 분리된 thin sibling.
 * 팀 합류는 초대 수락(`team-invitations`) 단독 경로다 — 참여코드로 합류하는
 * `POST teams/join` 은 초대 전용 규칙을 우회해서 제거했고 대체 경로도 두지 않는다.
 * POST   /api/v1/programs/:programId/teams
 * GET    /api/v1/programs/:programId/teams/me
 * DELETE /api/v1/programs/:programId/teams/me                  (본인 탈퇴)
 * DELETE /api/v1/programs/:programId/teams/me/members/:userId  (팀장의 팀원 제외)
 * GET    /api/v1/programs/:programId/teams          (교직원 전용)
 * GET    /api/v1/programs/:programId/teams/:teamId  (교직원 전용)
 * GET    /api/v1/programs/:programId/teams/:teamId/repository-url-history  (교직원 전용)
 * PATCH  /api/v1/programs/:programId/teams/:teamId  (팀장 또는 교직원)
 * DELETE /api/v1/programs/:programId/teams/:teamId  (교직원 전용)
 * DELETE /api/v1/programs/:programId/teams/:teamId/members/:userId  (교직원 전용)
 * PATCH  /api/v1/programs/:programId/teams/:teamId/leader            (교직원 전용)
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
      | 'getRepositoryUrlHistoryForStaff'
      | 'rename'
      | 'deleteForStaff'
      | 'removeMemberForStaff'
      | 'transferLeaderForStaff'
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

  @Get(':teamId/repository-url-history')
  @UseGuards(SessionGuard, ProgramTeamsStaffGuard)
  async repositoryUrlHistory(
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
    @Query() query: RepositoryUrlHistoryQueryRequestDto,
  ): Promise<RepositoryUrlHistoryResponseDto> {
    return RepositoryUrlHistoryResponseDto.from(
      await this.service.getRepositoryUrlHistoryForStaff(
        programId,
        teamId,
        query.toCursor(),
      ),
    );
  }

  /**
   * 팀 이름 변경 — 해당 팀의 현재 팀장과 교직원·관리자가 같은 문을 쓴다.
   * 그래서 `ProgramTeamsStaffGuard`를 붙이지 않는다 — 붙이면 팀장이 문 앞에서 막힌다.
   * 권한은 service가 판정하고, 최종 판정은 팀 행을 잠그고 난 뒤에 repository가 다시 한다.
   */
  @Patch(':teamId')
  @UseGuards(SessionGuard, OriginGuard)
  async rename(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
    @Body() body: RenameTeamRequestDto,
  ): Promise<RenameTeamResponseDto> {
    return RenameTeamResponseDto.from(
      await this.service.rename(
        request.sessionGithubId,
        programId,
        teamId,
        body.name,
      ),
    );
  }

  /**
   * 교직원 팀 삭제 — 가드를 붙이지 않는 것은 바로 위 `rename`과 같은 이유다. 교직원
   * 판정은 `ProgramLifecycleService.purge`와 같은 모양으로 service가 하고, 최종 판정은
   * 팀 행을 잠그고 난 뒤에 repository가 다시 한다.
   *
   * 본문을 받는 DELETE다 — `DELETE /programs/:id/purge`와 같은 계약이며,
   * `expectedScope`는 확인 창이 마지막으로 본 범위라 REQUIRED다.
   */
  /**
   * 교직원의 팀원 제외 — 행위자는 그 팀 밖에 있다.
   *
   * 학생 경로(`me/members/:userId`)와 URL이 닮았지만 다른 문이다. 그쪽은 정적 `me`
   * 아래라 이 동적 경로보다 먼저 선언돼 있어 서로 가로채지 않는다.
   *
   * 가드를 붙이지 않는 것은 `rename`·`remove`와 같은 이유다 — 교직원 판정을 service가
   * 하고, 최종 판정은 팀 행을 잠근 뒤 repository가 다시 한다.
   */
  @Delete(':teamId/members/:userId')
  @HttpCode(204)
  @UseGuards(SessionGuard, OriginGuard)
  async removeMemberForStaff(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.service.removeMemberForStaff(
      request.sessionGithubId,
      programId,
      teamId,
      userId,
    );
  }

  /**
   * 교직원의 팀장 변경 — 대상은 그 팀의 현재 구성원이어야 한다.
   * 이미 그 사람이 팀장이면 아무것도 바꾸지 않고 204로 끝난다.
   */
  @Patch(':teamId/leader')
  @HttpCode(204)
  @UseGuards(SessionGuard, OriginGuard)
  async transferLeaderForStaff(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
    @Body() body: TransferTeamLeaderRequestDto,
  ): Promise<void> {
    await this.service.transferLeaderForStaff(
      request.sessionGithubId,
      programId,
      teamId,
      body.userId,
    );
  }

  @Delete(':teamId')
  @UseGuards(SessionGuard, OriginGuard)
  async remove(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
    @Body() body: DeleteTeamRequestDto,
  ): Promise<DeleteTeamResponseDto> {
    return DeleteTeamResponseDto.from(
      await this.service.deleteForStaff(
        request.sessionGithubId,
        programId,
        teamId,
        body.expectedScope,
        body.notificationMessage ?? null,
      ),
    );
  }
}

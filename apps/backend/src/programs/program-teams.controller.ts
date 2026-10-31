import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { DeleteTeamRequestDto } from './dto/delete-team-request.dto';
import { MyProgramTeamResponseDto } from './dto/my-program-team-response.dto';
import { RenameTeamRequestDto } from './dto/rename-team-request.dto';
import { TransferTeamLeaderRequestDto } from './dto/transfer-team-leader-request.dto';
import {
  StaffTeamDetailResponseDto,
  RepositoryUrlHistoryResponseDto,
} from './dto/staff-team-detail-response.dto';
import { RepositoryUrlHistoryRequestDto } from './dto/repository-url-history-request.dto';
import { TeamActivityResponseDto } from './dto/team-activity-response.dto';
import {
  DeleteTeamResponseDto,
  ProgramTeamResponseDto,
  RenameTeamResponseDto,
  StaffProgramTeamResponseDto,
} from './dto/program-team-response.dto';
import { ProgramTeamsService } from './program-teams.service';
import { Protected } from '../auth/auth-route.decorator';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';
import { DomainException } from '../platform/error-code.error';
import { TEAMS_ERROR_CODES, TeamsErrorCode } from './teams-error-code.error';

type TeamSessionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const staffOnly = () =>
  new DomainException(TEAMS_ERROR_CODES[TeamsErrorCode.STAFF_ONLY]);

@Controller('programs/:programId/teams')
export class ProgramTeamsController {
  constructor(
    @Inject(ProgramTeamsService)
    private readonly service: Pick<
      ProgramTeamsService,
      | 'getMe'
      | 'leave'
      | 'removeMember'
      | 'listForStaff'
      | 'getForStaff'
      | 'getActivity'
      | 'getRepositoryUrlHistory'
      | 'repositoryUrlHistoryCursorFromRequest'
      | 'rename'
      | 'deleteForStaff'
      | 'removeMemberForStaff'
      | 'transferLeaderForStaff'
    >,
  ) {}

  @Get('me')
  @Protected()
  async me(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
  ): Promise<MyProgramTeamResponseDto<ProgramTeamResponseDto>> {
    const team = await this.service.getMe(request.sessionGithubId, programId);
    return MyProgramTeamResponseDto.from(
      team ? ProgramTeamResponseDto.from(team) : null,
    );
  }

  @Delete('me')
  @HttpCode(204)
  @Protected()
  @UseGuards(OriginGuard)
  async leave(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
  ): Promise<void> {
    await this.service.leave(request.sessionGithubId, programId);
  }

  @Delete('me/members/:userId')
  @HttpCode(204)
  @Protected()
  @UseGuards(OriginGuard)
  async removeMember(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.service.removeMember(request.sessionGithubId, programId, userId);
  }

  @Get()
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  async list(
    @Param('programId') programId: string,
  ): Promise<StaffProgramTeamResponseDto[]> {
    return StaffProgramTeamResponseDto.fromAll(
      await this.service.listForStaff(programId),
    );
  }

  @Get(':teamId')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  async detail(
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
  ): Promise<StaffTeamDetailResponseDto> {
    return StaffTeamDetailResponseDto.from(
      await this.service.getForStaff(programId, teamId),
    );
  }

  @Get(':teamId/activity')
  @Protected()
  async activity(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
  ): Promise<TeamActivityResponseDto> {
    return TeamActivityResponseDto.from(
      await this.service.getActivity(
        request.sessionGithubId,
        programId,
        teamId,
      ),
    );
  }

  @Get(':teamId/repository-url-history')
  @Protected()
  async repositoryUrlHistory(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
    @Query() query: RepositoryUrlHistoryRequestDto,
  ): Promise<RepositoryUrlHistoryResponseDto> {
    return RepositoryUrlHistoryResponseDto.from(
      await this.service.getRepositoryUrlHistory(
        request.sessionGithubId,
        programId,
        teamId,
        this.service.repositoryUrlHistoryCursorFromRequest(query),
      ),
    );
  }

  @Patch(':teamId')
  @Protected()
  @UseGuards(OriginGuard)
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

  @Delete(':teamId/members/:userId')
  @HttpCode(204)
  @Protected()
  @UseGuards(OriginGuard)
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

  @Patch(':teamId/leader')
  @HttpCode(204)
  @Protected()
  @UseGuards(OriginGuard)
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
  @Protected()
  @UseGuards(OriginGuard)
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

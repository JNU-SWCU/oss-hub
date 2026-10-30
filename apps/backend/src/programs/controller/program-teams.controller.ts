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
import { OriginGuard } from '../../auth/origin.guard';
import type { AuthenticatedRequest } from '../../auth/http-auth.types';
import { SessionGuard } from '../../auth/session.guard';
import { DeleteTeamRequestDto } from '../dto/delete-team-request.dto';
import { MyProgramTeamResponseDto } from '../dto/my-program-team-response.dto';
import { RenameTeamRequestDto } from '../dto/rename-team-request.dto';
import { TransferTeamLeaderRequestDto } from '../dto/transfer-team-leader-request.dto';
import {
  StaffTeamDetailResponseDto,
  RepositoryUrlHistoryResponseDto,
} from '../dto/team-detail-response.dto';
import { RepositoryUrlHistoryQueryRequestDto } from '../dto/repository-url-history-query.dto';
import { TeamActivityResponseDto } from '../dto/team-activity-response.dto';
import {
  DeleteTeamResponseDto,
  ProgramTeamResponseDto,
  RenameTeamResponseDto,
  StaffProgramTeamResponseDto,
} from '../dto/team-response.dto';
import { ProgramTeamsService } from '../service/program-teams.service';

type TeamSessionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

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
      | 'rename'
      | 'deleteForStaff'
      | 'removeMemberForStaff'
      | 'transferLeaderForStaff'
    >,
  ) {}

  @Get('me')
  @UseGuards(SessionGuard)
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
  @UseGuards(SessionGuard, OriginGuard)
  async leave(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
  ): Promise<void> {
    await this.service.leave(request.sessionGithubId, programId);
  }

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

  @Get()
  @UseGuards(SessionGuard)
  async list(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
  ): Promise<StaffProgramTeamResponseDto[]> {
    return StaffProgramTeamResponseDto.fromAll(
      await this.service.listForStaff(request.sessionGithubId, programId),
    );
  }

  @Get(':teamId')
  @UseGuards(SessionGuard)
  async detail(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
  ): Promise<StaffTeamDetailResponseDto> {
    return StaffTeamDetailResponseDto.from(
      await this.service.getForStaff(
        request.sessionGithubId,
        programId,
        teamId,
      ),
    );
  }

  @Get(':teamId/activity')
  @UseGuards(SessionGuard)
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
  @UseGuards(SessionGuard)
  async repositoryUrlHistory(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
    @Query() query: RepositoryUrlHistoryQueryRequestDto,
  ): Promise<RepositoryUrlHistoryResponseDto> {
    return RepositoryUrlHistoryResponseDto.from(
      await this.service.getRepositoryUrlHistory(
        request.sessionGithubId,
        programId,
        teamId,
        query.toCursor(),
      ),
    );
  }

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

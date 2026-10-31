import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import { ProgramOverviewTeamResponseDto } from './dto/program-overview-team-response.dto';
import { ProgramOverviewQueryRequestDto } from './dto/program-overview-query-request.dto';
import { ProgramOverviewResponseDto } from './dto/program-overview-response.dto';
import { ProgramOverviewService } from './program-overview.service';
import { Public } from '../auth/authentication.guard';

@Controller('programs/:programId/overview')
@UseGuards(SessionGuard)
export class ProgramOverviewController {
  constructor(private readonly service: ProgramOverviewService) {}

  @Get()
  async get(
    @Param('programId') programId: string,
    @Req() request: AuthenticatedRequest,
    @Query() query: ProgramOverviewQueryRequestDto = {},
  ): Promise<ProgramOverviewResponseDto> {
    const overview = await this.service.getOverview(
      programId,
      request.sessionGithubId,
      query.view === 'operations',
    );
    return ProgramOverviewResponseDto.from(overview);
  }

  @Get('teams')
  @Public()
  async listTeams(
    @Param('programId') programId: string,
  ): Promise<ProgramOverviewTeamResponseDto[]> {
    const teams = await this.service.getPublicTeams(programId);
    return teams.map((team) => ProgramOverviewTeamResponseDto.from(team));
  }
}

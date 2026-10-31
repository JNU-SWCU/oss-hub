import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { ProgramOverviewTeamResponseDto } from './dto/program-overview-team-response.dto';
import { ProgramOverviewQueryRequestDto } from './dto/program-overview-query-request.dto';
import { ProgramOverviewResponseDto } from './dto/program-overview-response.dto';
import { ProgramOverviewService } from './program-overview.service';
import { Protected } from '../auth/auth-route.decorator';

@Controller('programs/:programId/overview')
@Protected()
export class ProgramOverviewController {
  constructor(private readonly service: ProgramOverviewService) {}

  @Get()
  async get(
    @Param('programId') programId: string,
    @Req() request: AuthenticatedRequest,
    @Query() query: ProgramOverviewQueryRequestDto = {},
  ): Promise<ProgramOverviewResponseDto> {
    const overview = await this.service.getOverviewFromRequest(
      programId,
      request.sessionGithubId,
      query,
    );
    return ProgramOverviewResponseDto.from(overview);
  }

  @Get('teams')
  async listTeams(
    @Param('programId') programId: string,
  ): Promise<ProgramOverviewTeamResponseDto[]> {
    const teams = await this.service.getPublicTeams(programId);
    return teams.map((team) => ProgramOverviewTeamResponseDto.from(team));
  }
}

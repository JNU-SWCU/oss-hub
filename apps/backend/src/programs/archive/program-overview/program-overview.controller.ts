import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Public } from '../../../auth/controller/auth-route-metadata';
import type { AuthenticatedRequest } from '../../../auth/controller/http-auth';
import { SessionGuard } from '../../../auth/controller/session.guard';
import { ProgramOverviewTeamResponseDto } from './dto/program-overview-team-response.dto';
import { ProgramOverviewResponseDto } from './dto/program-overview-response.dto';
import { ProgramOverviewService } from './program-overview.service';

@Controller('programs/:programId/overview')
@UseGuards(SessionGuard)
export class ProgramOverviewController {
  constructor(private readonly service: ProgramOverviewService) {}

  @Get()
  async get(
    @Param('programId') programId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProgramOverviewResponseDto> {
    const overview = await this.service.getOverview(
      programId,
      request.sessionGithubId,
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

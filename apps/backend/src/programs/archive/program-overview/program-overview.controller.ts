import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  SessionGuard,
} from '../../../auth/session.guard';
import { Public } from '../../../auth/auth-route-metadata';
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

  /** 프로그램 내 공개 팀 목록 — 팀명·인원수·멤버 표시명·팀장 여부만. 저장소는 비공개. */
  @Get('teams')
  @Public()
  async listTeams(
    @Param('programId') programId: string,
  ): Promise<ProgramOverviewTeamResponseDto[]> {
    const teams = await this.service.getPublicTeams(programId);
    return teams.map((team) => ProgramOverviewTeamResponseDto.from(team));
  }
}

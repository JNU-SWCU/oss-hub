import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import { StaffDashboardSummaryResponseDto } from './dto/staff-dashboard-summary-response.dto';
import { StaffInsightsRequestDto } from './dto/staff-insights-request.dto';
import { StaffInsightsResponseDto } from './dto/staff-insights-response.dto';
import { StaffDashboardService } from './staff-dashboard.service';
import { StaffInsightsService } from './staff-insights.service';
import { StaffInsightsQueryService } from './staff-insights-query.service';

@Controller('dashboard/staff')
export class StaffDashboardController {
  constructor(
    @Inject(StaffDashboardService)
    private readonly service: Pick<StaffDashboardService, 'summary'>,
    @Inject(StaffInsightsService)
    private readonly insights: Pick<StaffInsightsService, 'summarize'>,
    private readonly staffInsightsQueryService: StaffInsightsQueryService,
  ) {}

  @Get('summary')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async summary(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
  ): Promise<StaffDashboardSummaryResponseDto> {
    return StaffDashboardSummaryResponseDto.from(
      await this.service.summary(request.sessionGithubId),
    );
  }

  @Get('insights')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async insightsSummary(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
    @Query() query: StaffInsightsRequestDto,
  ): Promise<StaffInsightsResponseDto> {
    return StaffInsightsResponseDto.from(
      await this.insights.summarize(
        request.sessionGithubId,
        this.staffInsightsQueryService.parseInsightsYearQuery(query.year),
      ),
    );
  }
}

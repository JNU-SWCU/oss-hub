import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/controller/http-auth';
import { SessionGuard } from '../auth/controller/session.guard';
import { StaffDashboardSummaryResponseDto } from './dto/staff-dashboard-summary-response.dto';
import { StaffInsightsQueryRequestDto } from './dto/staff-insights-query.dto';
import { StaffInsightsResponseDto } from './dto/staff-insights-response.dto';
import { StaffDashboardService } from './staff-dashboard.service';
import { parseInsightsYearQuery } from './staff-insights-year';
import { StaffInsightsService } from './staff-insights.service';

@Controller('dashboard/staff')
export class StaffDashboardController {
  constructor(
    @Inject(StaffDashboardService)
    private readonly service: Pick<StaffDashboardService, 'summary'>,
    @Inject(StaffInsightsService)
    private readonly insights: Pick<StaffInsightsService, 'summarize'>,
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
    @Query() query: StaffInsightsQueryRequestDto,
  ): Promise<StaffInsightsResponseDto> {
    return StaffInsightsResponseDto.from(
      await this.insights.summarize(
        request.sessionGithubId,
        parseInsightsYearQuery(query.year),
      ),
    );
  }
}

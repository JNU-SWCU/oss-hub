import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { ApplicationsStaffListGuard } from './applications-staff.guard';
import { StaffDashboardSummaryResponseDto } from './dto/staff-dashboard-summary-response.dto';
import { StaffInsightsQueryRequestDto } from './dto/staff-insights-query.dto';
import { StaffInsightsResponseDto } from './dto/staff-insights-response.dto';
import { StaffDashboardService } from './staff-dashboard.service';
import { parseInsightsYearQuery } from './staff-insights-year';
import { StaffInsightsService } from './staff-insights.service';

/**
 * 교직원 운영 대시보드 thin sibling — StudentDashboardController 미러.
 * GET /api/v1/dashboard/staff/summary (#117)
 * GET /api/v1/dashboard/staff/insights
 */
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
  @UseGuards(SessionGuard, ApplicationsStaffListGuard)
  async summary(): Promise<StaffDashboardSummaryResponseDto> {
    return StaffDashboardSummaryResponseDto.from(await this.service.summary());
  }

  @Get('insights')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard, ApplicationsStaffListGuard)
  async insightsSummary(
    @Query() query: StaffInsightsQueryRequestDto,
  ): Promise<StaffInsightsResponseDto> {
    return StaffInsightsResponseDto.from(
      await this.insights.summarize(parseInsightsYearQuery(query.year)),
    );
  }
}

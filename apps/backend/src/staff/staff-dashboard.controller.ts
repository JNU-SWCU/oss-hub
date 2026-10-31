import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { StaffDashboardSummaryResponseDto } from './dto/staff-dashboard-summary-response.dto';
import { StaffInsightsRequestDto } from './dto/staff-insights-request.dto';
import { StaffInsightsResponseDto } from './dto/staff-insights-response.dto';
import { StaffDashboardService } from './staff-dashboard.service';
import { StaffInsightsService } from './staff-insights.service';
import { StaffInsightsQueryService } from './staff-insights-query.service';
import { Protected } from '../auth/authentication.guard';
import { Roles, STAFF_AUDIENCE } from '../platform/roles.guard';
import { DomainException } from '../platform/error-code.error';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from '../programs/applications-error-code.error';

const staffListOnly = () =>
  new DomainException(
    APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_LIST_ONLY],
  );

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
  @Protected()
  @Roles(STAFF_AUDIENCE, staffListOnly)
  async summary(): Promise<StaffDashboardSummaryResponseDto> {
    return StaffDashboardSummaryResponseDto.from(await this.service.summary());
  }

  @Get('insights')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffListOnly)
  async insightsSummary(
    @Query() query: StaffInsightsRequestDto,
  ): Promise<StaffInsightsResponseDto> {
    return StaffInsightsResponseDto.from(
      await this.insights.summarize(
        this.staffInsightsQueryService.parseInsightsYearQuery(query.year),
      ),
    );
  }
}

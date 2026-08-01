import { Controller, Get, Header, Inject, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { ApplicationsStaffListGuard } from './applications-staff.guard';
import { StaffDashboardSummaryResponseDto } from './dto/staff-dashboard-summary-response.dto';
import { StaffDashboardService } from './staff-dashboard.service';

/**
 * 교직원 운영 대시보드 thin sibling — StudentDashboardController 미러.
 * GET /api/v1/dashboard/staff/summary (#117)
 */
@Controller('dashboard/staff')
export class StaffDashboardController {
  constructor(
    @Inject(StaffDashboardService)
    private readonly service: Pick<StaffDashboardService, 'summary'>,
  ) {}

  @Get('summary')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard, ApplicationsStaffListGuard)
  async summary(): Promise<StaffDashboardSummaryResponseDto> {
    return StaffDashboardSummaryResponseDto.from(await this.service.summary());
  }
}

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { ApplicationsStaffListGuard } from './applications-staff.guard';
import { ApplicationsService } from './applications.service';
import { StaffDashboardSummaryResponseDto } from './dto/staff-dashboard-summary-response.dto';

/**
 * 교직원 운영 대시보드 thin sibling — StudentDashboardController 미러.
 * GET /api/v1/dashboard/staff/summary (#117)
 */
@Controller('dashboard/staff')
export class StaffDashboardController {
  constructor(
    @Inject(ApplicationsService)
    private readonly service: Pick<ApplicationsService, 'staffSummary'>,
  ) {}

  @Get('summary')
  @UseGuards(SessionGuard, ApplicationsStaffListGuard)
  async summary(): Promise<StaffDashboardSummaryResponseDto> {
    return StaffDashboardSummaryResponseDto.from(
      await this.service.staffSummary(),
    );
  }
}

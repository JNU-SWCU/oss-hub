import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProgramsModule } from '../programs/programs.module';
import { UsersModule } from '../users/users.module';
import { AccessRequestsController } from './access-requests.controller';
import { StaffDashboardController } from './staff-dashboard.controller';
import { StaffDashboardService } from './staff-dashboard.service';
import { StaffInsightsRepository } from './staff-insights.repository';
import { StaffInsightsService } from './staff-insights.service';

@Module({
  imports: [AuthModule, ProgramsModule, UsersModule],
  controllers: [StaffDashboardController, AccessRequestsController],
  providers: [
    StaffDashboardService,
    StaffInsightsRepository,
    StaffInsightsService,
  ],
})
export class StaffModule {}

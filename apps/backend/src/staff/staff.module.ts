import { Module } from '@nestjs/common';
import { ProgramsModule } from '../programs/programs.module';
import { UsersModule } from '../users/users.module';
import { AccessRequestsController } from './access-requests.controller';
import { StaffDashboardController } from './staff-dashboard.controller';
import { StaffDashboardService } from './staff-dashboard.service';
import { StaffInsightsRepository } from './staff-insights.repository';
import { StaffInsightsService } from './staff-insights.service';
import { RankingModule } from '../ranking/ranking.module';
import { StaffInsightsQueryService } from './staff-insights-query.service';

@Module({
  imports: [ProgramsModule, RankingModule, UsersModule],
  controllers: [StaffDashboardController, AccessRequestsController],
  providers: [
    StaffDashboardService,
    StaffInsightsRepository,
    StaffInsightsService,
    StaffInsightsQueryService,
  ],
})
export class StaffModule {}

import { Module } from '@nestjs/common';
import { ProgramMetricsRepository } from '../../repository/program-metrics.repository';
import { PublicEligibilityService } from './public-eligibility.service';

@Module({
  providers: [ProgramMetricsRepository, PublicEligibilityService],
  exports: [ProgramMetricsRepository, PublicEligibilityService],
})
export class PublicEligibilityModule {}

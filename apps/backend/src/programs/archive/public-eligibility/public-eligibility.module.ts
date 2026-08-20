import { Module } from '@nestjs/common';
import { ProgramMetricsRepository } from '../../repository/program-metrics.repository';
import { PublicEligibilityService } from './public-eligibility.service';

/**
 * Public eligibility shares ProgramMetricsRepository with public-projects.
 */
@Module({
  providers: [ProgramMetricsRepository, PublicEligibilityService],
  exports: [ProgramMetricsRepository, PublicEligibilityService],
})
export class PublicEligibilityModule {}

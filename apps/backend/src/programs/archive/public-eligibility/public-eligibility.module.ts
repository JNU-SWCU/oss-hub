import { Module } from '@nestjs/common';
import { PublicEligibilityRepository } from './repository/public-eligibility.repository';
import { PublicEligibilityService } from './service/public-eligibility.service';

@Module({
  providers: [PublicEligibilityRepository, PublicEligibilityService],
  exports: [PublicEligibilityService],
})
export class PublicEligibilityModule {}

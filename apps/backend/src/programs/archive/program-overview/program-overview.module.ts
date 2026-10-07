import { Module } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';
import { ProgramOverviewController } from './program-overview.controller';
import { ProgramOverviewRepository } from './program-overview.repository';
import { ProgramOverviewService } from './program-overview.service';

@Module({
  imports: [AuthModule],
  controllers: [ProgramOverviewController],
  providers: [ProgramOverviewService, ProgramOverviewRepository],
  exports: [ProgramOverviewService],
})
export class ProgramOverviewModule {}

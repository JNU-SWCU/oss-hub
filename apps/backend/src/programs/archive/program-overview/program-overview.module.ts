import { Module } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';
import { ProgramOverviewController } from './controller/program-overview.controller';
import { ProgramOverviewRepository } from './repository/program-overview.repository';
import { ProgramOverviewService } from './service/program-overview.service';

@Module({
  imports: [AuthModule],
  controllers: [ProgramOverviewController],
  providers: [ProgramOverviewService, ProgramOverviewRepository],
  exports: [ProgramOverviewService],
})
export class ProgramOverviewModule {}

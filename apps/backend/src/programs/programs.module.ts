import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProgramActivityService } from './program-activity.service';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';

@Module({
  imports: [AuthModule],
  controllers: [ProgramsController],
  providers: [ProgramsService, ProgramActivityService, ProgramViewerService],
})
export class ProgramsModule {}

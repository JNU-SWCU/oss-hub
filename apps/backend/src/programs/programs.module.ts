import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProgramCreationService } from './program-creation.service';
import { ProgramActivityService } from './program-activity.service';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsController } from './programs.controller';
import { ProgramsRepository } from './programs.repository';
import { ProgramsService } from './programs.service';

@Module({
  imports: [AuthModule],
  controllers: [ProgramsController],
  providers: [
    ProgramsService,
    ProgramsRepository,
    ProgramCreationService,
    ProgramActivityService,
    ProgramViewerService,
  ],
})
export class ProgramsModule {}

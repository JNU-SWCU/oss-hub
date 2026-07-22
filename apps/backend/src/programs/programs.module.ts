import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MilestonesController } from './milestones.controller';
import { ProgramCreationService } from './program-creation.service';
import { ProgramActivityService } from './program-activity.service';
import { ProgramEditorController } from './program-editor.controller';
import { ProgramEditorRepository } from './program-editor.repository';
import { ProgramEditorService } from './program-editor.service';
import { ProgramViewerService } from './program-viewer.service';
import {
  ProgramsController,
  StudentDashboardController,
} from './programs.controller';
import { ProgramsRepository } from './programs.repository';
import { ProgramsService } from './programs.service';

@Module({
  imports: [AuthModule],
  controllers: [
    ProgramsController,
    StudentDashboardController,
    ProgramEditorController,
    MilestonesController,
  ],
  providers: [
    ProgramsService,
    ProgramsRepository,
    ProgramCreationService,
    ProgramActivityService,
    ProgramViewerService,
    ProgramEditorService,
    ProgramEditorRepository,
  ],
})
export class ProgramsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CollectionModule } from '../collection/collection.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import { ApplicationTemplatesController } from './application-templates.controller';
import { MilestonesController } from './milestones.controller';
import { ProgramCreationService } from './program-creation.service';
import { ProgramActivityService } from './program-activity.service';
import { ProgramEditorController } from './program-editor.controller';
import { ProgramEditorRepository } from './program-editor.repository';
import { ProgramEditorService } from './program-editor.service';
import { ProgramTeamsController } from './program-teams.controller';
import { ProgramTeamsRepository } from './program-teams.repository';
import { ProgramTeamsService } from './program-teams.service';
import { ProgramViewerService } from './program-viewer.service';
import {
  ProgramsController,
  StudentDashboardController,
} from './programs.controller';
import { ProgramsRepository } from './programs.repository';
import { ProgramsService } from './programs.service';
import { StudentDashboardService } from './student-dashboard.service';

@Module({
  imports: [AuthModule, CollectionModule, RepositoriesModule],
  controllers: [
    // static sibling first — programs/application-templates before programs/:id
    ApplicationTemplatesController,
    ProgramsController,
    StudentDashboardController,
    ProgramEditorController,
    MilestonesController,
    ProgramTeamsController,
  ],
  providers: [
    ProgramsService,
    ProgramsRepository,
    ProgramCreationService,
    ProgramActivityService,
    ProgramViewerService,
    StudentDashboardService,
    ProgramEditorService,
    ProgramEditorRepository,
    ProgramTeamsService,
    ProgramTeamsRepository,
  ],
})
export class ProgramsModule {}

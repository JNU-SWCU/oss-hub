import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { CollectionModule } from '../github/collection.module';
import { RepositoriesModule } from '../github/repositories.module';
import { ApplicationTemplatesController } from './controller/application-templates.controller';
import { MilestonesController } from './controller/milestones.controller';
import { ProgramCreationService } from './service/program-creation.service';
import { PROGRAM_ACTIVITY_SUMMARY_PORT } from './program-activity-summary.port';
import { ProgramActivitySummaryRepository } from './repository/program-activity-summary.repository';
import { ProgramActivitySummaryService } from './service/program-activity-summary.service';
import { ProgramActivityService } from './service/program-activity.service';
import { ProgramEditorController } from './controller/program-editor.controller';
import { ProgramEditorRepository } from './repository/program-editor.repository';
import { ProgramEditorService } from './service/program-editor.service';
import { ProgramLifecycleService } from './service/program-lifecycle.service';
import { ProgramTeamsStaffGuard } from './program-teams-staff.guard';
import { ProgramTeamsController } from './controller/program-teams.controller';
import { ProgramTeamsRepository } from './repository/program-teams.repository';
import { ProgramTeamsService } from './service/program-teams.service';
import { ProgramViewerService } from './service/program-viewer.service';
import {
  ProgramsController,
  StudentDashboardController,
} from './controller/programs.controller';
import { ProgramsRepository } from './repository/programs.repository';
import { ProgramsService } from './service/programs.service';
import { StudentDashboardService } from './service/student-dashboard.service';

@Module({
  imports: [AuthModule, AuditLogModule, CollectionModule, RepositoriesModule],
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
    ProgramActivitySummaryRepository,
    ProgramActivitySummaryService,
    {
      provide: PROGRAM_ACTIVITY_SUMMARY_PORT,
      useExisting: ProgramActivitySummaryService,
    },
    ProgramActivityService,
    ProgramViewerService,
    StudentDashboardService,
    ProgramEditorService,
    ProgramEditorRepository,
    ProgramLifecycleService,
    ProgramTeamsService,
    ProgramTeamsRepository,
    ProgramTeamsStaffGuard,
  ],
  exports: [PROGRAM_ACTIVITY_SUMMARY_PORT],
})
export class ProgramsModule {}

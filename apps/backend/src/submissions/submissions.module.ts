import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AuthModule } from '../auth/auth.module';
import { SubmissionFileCleanupScheduler } from './job/submission-file-cleanup.scheduler';
import { SubmissionFileCleanupService } from './service/submission-file-cleanup.service';
import { SubmissionFileCleanupRetryService } from './service/submission-file-cleanup-retry.service';
import { SubmissionFilesRepository } from './repository/submission-files.repository';
import { SubmissionFilesService } from './service/submission-files.service';
import { SubmissionDashboardSummaryRepository } from './repository/submission-dashboard-summary.repository';
import { SubmissionDashboardSummaryService } from './service/submission-dashboard-summary.service';
import { SubmissionMatrixRepository } from './repository/submission-matrix.repository';
import { SubmissionMatrixService } from './service/submission-matrix.service';
import { SubmissionsController } from './controller/submissions.controller';
import { SubmissionChecklistController } from './controller/submission-checklist.controller';
import { SubmissionFilesController } from './controller/submission-files.controller';
import { SubmissionFormsController } from './controller/submission-forms.controller';
import { SubmissionMatrixController } from './controller/submission-matrix.controller';
import { SubmissionsRepository } from './repository/submissions.repository';
import { SubmissionsService } from './service/submissions.service';

@Module({
  imports: [PlatformModule, AuthModule],
  controllers: [
    SubmissionFilesController,
    SubmissionChecklistController,
    SubmissionFormsController,
    SubmissionMatrixController,
    SubmissionsController,
  ],
  providers: [
    SubmissionsRepository,
    SubmissionFilesRepository,
    SubmissionFilesService,
    SubmissionFileCleanupService,
    SubmissionFileCleanupRetryService,
    SubmissionFileCleanupScheduler,
    SubmissionsService,
    SubmissionDashboardSummaryRepository,
    SubmissionDashboardSummaryService,
    SubmissionMatrixRepository,
    SubmissionMatrixService,
  ],
  exports: [
    SubmissionDashboardSummaryService,
    SubmissionFileCleanupService,
    SubmissionFilesService,
  ],
})
export class SubmissionsModule {}

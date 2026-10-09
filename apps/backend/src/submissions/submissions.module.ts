import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubmissionFileCleanupFailuresController } from './submission-file-cleanup-failures.controller';
import { SubmissionFileCleanupFailuresService } from './submission-file-cleanup-failures.service';
import { SubmissionFileCleanupScheduler } from './submission-file-cleanup.scheduler';
import { SubmissionFileCleanupService } from './submission-file-cleanup.service';
import { StorageModule } from '../storage/storage.module';
import { SubmissionFilesRepository } from './submission-files.repository';
import { SubmissionFilesService } from './submission-files.service';
import { SubmissionDashboardSummaryRepository } from './submission-dashboard-summary.repository';
import { SubmissionDashboardSummaryService } from './submission-dashboard-summary.service';
import { SubmissionMatrixRepository } from './submission-matrix.repository';
import { SubmissionMatrixService } from './submission-matrix.service';
import {
  SubmissionChecklistController,
  SubmissionFilesController,
  SubmissionFormsController,
  SubmissionMatrixController,
  SubmissionsController,
} from './submissions.controller';
import { SubmissionsRepository } from './submissions.repository';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [
    SubmissionFileCleanupFailuresController,
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
    SubmissionFileCleanupFailuresService,
    SubmissionFileCleanupScheduler,
    SubmissionsService,
    SubmissionDashboardSummaryRepository,
    SubmissionDashboardSummaryService,
    SubmissionMatrixRepository,
    SubmissionMatrixService,
  ],
  exports: [SubmissionDashboardSummaryService, SubmissionFileCleanupService],
})
export class SubmissionsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubmissionFileCleanupScheduler } from './submission-file-cleanup.scheduler';
import { SubmissionFileCleanupService } from './submission-file-cleanup.service';
import { S3SubmissionFileStorage } from './s3-submission-file.storage';
import { SubmissionFileStorageConfig } from './submission-file-storage.config';
import { SUBMISSION_FILE_STORAGE } from './submission-file-storage.port';
import { SubmissionFilesStore } from './submission-files.store';
import { SubmissionFilesService } from './submission-files.service';
import { SubmissionDashboardSummaryStore } from './submission-dashboard-summary.store';
import { SUBMISSION_DASHBOARD_SUMMARY_PORT } from './submission-dashboard-summary.port';
import { SubmissionDashboardSummaryService } from './submission-dashboard-summary.service';
import { SubmissionMatrixStore } from './submission-matrix.store';
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
  imports: [AuthModule],
  controllers: [
    SubmissionFilesController,
    SubmissionChecklistController,
    SubmissionFormsController,
    SubmissionMatrixController,
    SubmissionsController,
  ],
  providers: [
    SubmissionsRepository,
    SubmissionFilesStore,
    SubmissionFilesService,
    SubmissionFileCleanupService,
    SubmissionFileCleanupScheduler,
    SubmissionFileStorageConfig,
    S3SubmissionFileStorage,
    {
      provide: SUBMISSION_FILE_STORAGE,
      useExisting: S3SubmissionFileStorage,
    },
    SubmissionsService,
    SubmissionDashboardSummaryStore,
    SubmissionDashboardSummaryService,
    {
      provide: SUBMISSION_DASHBOARD_SUMMARY_PORT,
      useExisting: SubmissionDashboardSummaryService,
    },
    SubmissionMatrixStore,
    SubmissionMatrixService,
  ],
  exports: [SUBMISSION_DASHBOARD_SUMMARY_PORT],
})
export class SubmissionsModule {}

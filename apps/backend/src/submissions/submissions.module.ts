import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubmissionFileCleanupScheduler } from './submission-file-cleanup.scheduler';
import { SubmissionFileCleanupService } from './submission-file-cleanup.service';
import { S3SubmissionFileStorage } from './s3-submission-file.storage';
import { SubmissionFileStorageConfig } from './submission-file-storage.config';
import { SUBMISSION_FILE_STORAGE } from './submission-file-storage.port';
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
    SubmissionFilesRepository,
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
    SubmissionDashboardSummaryRepository,
    SubmissionDashboardSummaryService,
    SubmissionMatrixRepository,
    SubmissionMatrixService,
  ],
  exports: [SubmissionDashboardSummaryService],
})
export class SubmissionsModule {}

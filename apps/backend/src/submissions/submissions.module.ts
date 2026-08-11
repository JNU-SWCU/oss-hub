import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { e2eProgramAuthoringControlEnabled } from '../e2e-program-authoring/e2e-program-authoring.config';
import { e2eProgramAuthoringExternalPorts } from '../e2e-program-authoring/e2e-external-ports';
import { SubmissionFileCleanupFailuresController } from './submission-file-cleanup-failures.controller';
import { SubmissionFileCleanupFailuresService } from './submission-file-cleanup-failures.service';
import { SubmissionFileCleanupScheduler } from './submission-file-cleanup.scheduler';
import { SubmissionFileCleanupService } from './submission-file-cleanup.service';
import { S3SubmissionFileStorage } from './s3-submission-file.storage';
import { SubmissionFileStorageConfig } from './submission-file-storage.config';
import {
  SUBMISSION_FILE_STORAGE,
  type SubmissionFileStoragePort,
} from './submission-file-storage.port';
import { SubmissionFilesRepository } from './submission-files.repository';
import { SubmissionFilesService } from './submission-files.service';
import { SubmissionDashboardSummaryRepository } from './submission-dashboard-summary.repository';
import { SUBMISSION_DASHBOARD_SUMMARY_PORT } from './submission-dashboard-summary.port';
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

export function resolveSubmissionFileStorage(
  storage: SubmissionFileStoragePort,
  env: NodeJS.ProcessEnv = process.env,
): SubmissionFileStoragePort {
  return e2eProgramAuthoringControlEnabled(env)
    ? e2eProgramAuthoringExternalPorts.storage
    : storage;
}

@Module({
  imports: [AuthModule],
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
    SubmissionFileStorageConfig,
    S3SubmissionFileStorage,
    {
      provide: SUBMISSION_FILE_STORAGE,
      inject: [S3SubmissionFileStorage],
      useFactory: (
        storage: S3SubmissionFileStorage,
      ): SubmissionFileStoragePort => resolveSubmissionFileStorage(storage),
    },
    SubmissionsService,
    SubmissionDashboardSummaryRepository,
    SubmissionDashboardSummaryService,
    {
      provide: SUBMISSION_DASHBOARD_SUMMARY_PORT,
      useExisting: SubmissionDashboardSummaryService,
    },
    SubmissionMatrixRepository,
    SubmissionMatrixService,
  ],
  exports: [
    SUBMISSION_DASHBOARD_SUMMARY_PORT,
    SUBMISSION_FILE_STORAGE,
    SubmissionFileCleanupService,
  ],
})
export class SubmissionsModule {}

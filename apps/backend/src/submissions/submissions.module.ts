import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { SubmissionFileCleanupFailuresController } from './controller/submission-file-cleanup-failures.controller';
import { SubmissionFileCleanupFailuresService } from './service/submission-file-cleanup-failures.service';
import { SubmissionFileCleanupScheduler } from './job/submission-file-cleanup.scheduler';
import { SubmissionFileCleanupService } from './service/submission-file-cleanup.service';
import { SubmissionFileCleanupRetryService } from './service/submission-file-cleanup-retry.service';
import { StorageModule } from '../storage/storage.module';
import { SubmissionFilesRepository } from './repository/submission-files.repository';
import { SubmissionFilesService } from './service/submission-files.service';
import { SubmissionDashboardSummaryRepository } from './repository/submission-dashboard-summary.repository';
import { SubmissionDashboardSummaryService } from './service/submission-dashboard-summary.service';
import { SubmissionMatrixRepository } from './repository/submission-matrix.repository';
import { SubmissionMatrixService } from './service/submission-matrix.service';
import {
  SubmissionChecklistController,
  SubmissionFilesController,
  SubmissionFormsController,
  SubmissionMatrixController,
  SubmissionsController,
} from './controller/submissions.controller';
import { SubmissionsRepository } from './repository/submissions.repository';
import { SubmissionsService } from './service/submissions.service';

@Module({
  imports: [AuditLogModule, AuthModule, StorageModule],
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

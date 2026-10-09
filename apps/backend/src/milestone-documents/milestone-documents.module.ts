import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';

import { StorageModule } from '../storage/storage.module';
import { SubmissionFilesRepository } from '../submissions/submission-files.repository';
import {
  MilestoneDocumentFilesController,
  MilestoneDocumentsController,
} from './milestone-documents.controller';
import { MilestoneDocumentArchiveRepository } from './milestone-document-archive.repository';
import { ProgramDocumentArchivesController } from './program-document-archives.controller';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import { MilestoneDocumentCollectionService } from './milestone-document-collection.service';
import { MilestoneDocumentCollectionReadRepository } from './milestone-document-collection-read.repository';
import { MilestoneDocumentCurrentFileController } from './milestone-document-current-file.controller';
import { MilestoneDocumentCurrentFileRepository } from './milestone-document-current-file.repository';
import { MilestoneDocumentCurrentFileService } from './milestone-document-current-file.service';
import { MilestoneDocumentFeedbackController } from './controller/milestone-document-feedback.controller';
import { MilestoneDocumentFeedbackRepository } from './repository/milestone-document-feedback.repository';
import {
  MILESTONE_DOCUMENT_FEEDBACK_CLOCK,
  MilestoneDocumentFeedbackService,
} from './service/milestone-document-feedback.service';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsRepository } from './repository/milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';
import { MilestoneDocumentsStaffGuard } from './milestone-documents-staff.guard';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [
    ProgramDocumentArchivesController,
    MilestoneDocumentsController,
    MilestoneDocumentFilesController,
    MilestoneDocumentCurrentFileController,
    MilestoneDocumentFeedbackController,
  ],
  providers: [
    MilestoneDocumentsService,
    MilestoneDocumentsRepository,
    MilestoneDocumentCollectionService,
    MilestoneDocumentCollectionReadRepository,
    MilestoneDocumentCurrentFileRepository,
    MilestoneDocumentCurrentFileService,
    MilestoneDocumentFeedbackRepository,
    MilestoneDocumentFeedbackService,
    { provide: MILESTONE_DOCUMENT_FEEDBACK_CLOCK, useValue: () => new Date() },
    MilestoneDocumentFilesService,
    MilestoneDocumentReviewsService,
    MilestoneDocumentArchiveService,
    MilestoneDocumentArchiveRepository,
    MilestoneDocumentsStaffGuard,

    SubmissionFilesRepository,
  ],
  exports: [
    MilestoneDocumentsService,
    MilestoneDocumentFilesService,
    MilestoneDocumentCurrentFileService,
  ],
})
export class MilestoneDocumentsModule {}

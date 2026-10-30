import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

import { SubmissionsModule } from '../submissions/submissions.module';
import {
  MilestoneDocumentFilesController,
  MilestoneDocumentsController,
} from './controller/milestone-documents.controller';
import { MilestoneDocumentArchiveRepository } from './repository/milestone-document-archive.repository';
import { ProgramDocumentArchivesController } from './controller/program-document-archives.controller';
import { ProgramDocumentChangeRequestsController } from './controller/program-document-change-requests.controller';
import { ProgramDocumentChangeRequestsService } from './service/program-document-change-requests.service';
import { MilestoneDocumentArchiveService } from './service/milestone-document-archive.service';
import { MilestoneDocumentCollectionService } from './service/milestone-document-collection.service';
import { MilestoneDocumentCollectionReadRepository } from './repository/milestone-document-collection-read.repository';
import { MilestoneDocumentCurrentFileController } from './controller/milestone-document-current-file.controller';
import { MilestoneDocumentCurrentFileRepository } from './repository/milestone-document-current-file.repository';
import { MilestoneDocumentCurrentFileService } from './service/milestone-document-current-file.service';
import { MilestoneDocumentFeedbackController } from './controller/milestone-document-feedback.controller';
import { MilestoneDocumentFeedbackRepository } from './repository/milestone-document-feedback.repository';
import {
  MILESTONE_DOCUMENT_FEEDBACK_CLOCK,
  MilestoneDocumentFeedbackService,
} from './service/milestone-document-feedback.service';
import { MilestoneDocumentFilesService } from './service/milestone-document-files.service';
import { MilestoneDocumentReviewsService } from './service/milestone-document-reviews.service';
import { MilestoneDocumentsRepository } from './repository/milestone-documents.repository';
import { MilestoneDocumentsService } from './service/milestone-documents.service';

@Module({
  imports: [AuthModule, PlatformModule, SubmissionsModule, UsersModule],
  controllers: [
    ProgramDocumentArchivesController,
    ProgramDocumentChangeRequestsController,
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
    ProgramDocumentChangeRequestsService,
    MilestoneDocumentArchiveService,
    MilestoneDocumentArchiveRepository,
  ],
  exports: [
    MilestoneDocumentsService,
    MilestoneDocumentFilesService,
    MilestoneDocumentCurrentFileService,
  ],
})
export class MilestoneDocumentsModule {}

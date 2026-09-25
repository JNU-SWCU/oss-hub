import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
// 파일 저장 스택은 submissions/의 SubmissionFile·S3(object-storage) 경로를 그대로 재사용한다 —
// SubmissionsModule을 import해 그 provider를 그대로 쓴다(새 업로드 스택 금지).
import { SubmissionsModule } from '../submissions/submissions.module';
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
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';
import { MilestoneDocumentsStaffGuard } from './milestone-documents-staff.guard';

/**
 * #619 마일스톤별 서류 항목(MilestoneDocument/MilestoneDocumentTemplateFile/
 * MilestoneDocumentSubmission/MilestoneDocumentReviewHistory) 모듈. 목록 조회(viewer 역할별 분기) ·
 * 학생 제출/재제출 · 교직원 CRUD · 양식 업로드/다운로드 · 교직원 판정까지 갖춘다.
 */
@Module({
  imports: [AuthModule, SubmissionsModule],
  controllers: [
    ProgramDocumentArchivesController,
    MilestoneDocumentsController,
    MilestoneDocumentFilesController,
    MilestoneDocumentCurrentFileController,
  ],
  providers: [
    MilestoneDocumentsService,
    MilestoneDocumentsRepository,
    MilestoneDocumentCollectionService,
    MilestoneDocumentCollectionReadRepository,
    MilestoneDocumentCurrentFileRepository,
    MilestoneDocumentCurrentFileService,
    MilestoneDocumentFilesService,
    MilestoneDocumentReviewsService,
    MilestoneDocumentArchiveService,
    MilestoneDocumentArchiveRepository,
    MilestoneDocumentsStaffGuard,
    // 학생 서류 파일의 pending 행도 submissions/의 SubmissionFilesRepository가 만든다 —
    // 같은 SubmissionFile 테이블을 쓰므로 보관 할당량·잠금 순서를 한 곳에서만 정한다.
    SubmissionFilesRepository,
  ],
  exports: [
    MilestoneDocumentsService,
    MilestoneDocumentFilesService,
    MilestoneDocumentCurrentFileService,
  ],
})
export class MilestoneDocumentsModule {}

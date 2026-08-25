import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { e2eProgramAuthoringControlEnabled } from '../e2e-program-authoring/e2e-program-authoring.config';
import { e2eProgramAuthoringExternalPorts } from '../e2e-program-authoring/e2e-external-ports';
// 파일 저장 스택은 submissions/의 SubmissionFile·S3(MinIO) 경로를 그대로 재사용한다 —
// submissions.module.ts와 동일한 provider 구성을 이 모듈에도 등록한다(새 업로드 스택 금지).
import { S3SubmissionFileStorage } from '../submissions/s3-submission-file.storage';
import { SubmissionFileStorageConfig } from '../submissions/submission-file-storage.config';
import { SUBMISSION_FILE_STORAGE } from '../submissions/submission-file-storage.port';
import { SubmissionFilesRepository } from '../submissions/submission-files.repository';
import {
  MilestoneDocumentFilesController,
  MilestoneDocumentsController,
} from './milestone-documents.controller';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
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
  imports: [AuthModule],
  controllers: [
    MilestoneDocumentsController,
    MilestoneDocumentFilesController,
    MilestoneDocumentCurrentFileController,
  ],
  providers: [
    MilestoneDocumentsService,
    MilestoneDocumentsRepository,
    MilestoneDocumentCurrentFileRepository,
    MilestoneDocumentCurrentFileService,
    MilestoneDocumentFilesService,
    MilestoneDocumentReviewsService,
    MilestoneDocumentArchiveService,
    MilestoneDocumentsStaffGuard,
    SubmissionFileStorageConfig,
    S3SubmissionFileStorage,
    // 학생 서류 파일의 pending 행도 submissions/의 SubmissionFilesRepository가 만든다 —
    // 같은 SubmissionFile 테이블을 쓰므로 보관 할당량·잠금 순서를 한 곳에서만 정한다.
    SubmissionFilesRepository,
    {
      provide: SUBMISSION_FILE_STORAGE,
      inject: [S3SubmissionFileStorage],
      useFactory: (storage: S3SubmissionFileStorage) =>
        e2eProgramAuthoringControlEnabled()
          ? e2eProgramAuthoringExternalPorts.storage
          : storage,
    },
  ],
  exports: [
    MilestoneDocumentsService,
    MilestoneDocumentFilesService,
    MilestoneDocumentCurrentFileService,
  ],
})
export class MilestoneDocumentsModule {}

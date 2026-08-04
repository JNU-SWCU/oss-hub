import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
// 파일 저장 스택은 submissions/의 SubmissionFile·S3(MinIO) 경로를 그대로 재사용한다 —
// submissions.module.ts와 동일한 provider 구성을 이 모듈에도 등록한다(새 업로드 스택 금지).
import { S3SubmissionFileStorage } from '../submissions/s3-submission-file.storage';
import { SubmissionFileStorageConfig } from '../submissions/submission-file-storage.config';
import { SUBMISSION_FILE_STORAGE } from '../submissions/submission-file-storage.port';
import {
  MilestoneDocumentFilesController,
  MilestoneDocumentsController,
} from './milestone-documents.controller';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';
import { MilestoneDocumentsStaffGuard } from './milestone-documents-staff.guard';

/**
 * #619 마일스톤별 서류 항목(MilestoneDocument/MilestoneDocumentTemplateFile/
 * MilestoneDocumentSubmission) 모듈. 목록 조회(viewer 역할별 분기) · 학생 제출/재제출 ·
 * 교직원 CRUD · 양식 업로드/다운로드까지 갖춘다.
 */
@Module({
  imports: [AuthModule],
  controllers: [MilestoneDocumentsController, MilestoneDocumentFilesController],
  providers: [
    MilestoneDocumentsService,
    MilestoneDocumentsRepository,
    MilestoneDocumentFilesService,
    MilestoneDocumentsStaffGuard,
    SubmissionFileStorageConfig,
    S3SubmissionFileStorage,
    {
      provide: SUBMISSION_FILE_STORAGE,
      useExisting: S3SubmissionFileStorage,
    },
  ],
  exports: [MilestoneDocumentsService],
})
export class MilestoneDocumentsModule {}

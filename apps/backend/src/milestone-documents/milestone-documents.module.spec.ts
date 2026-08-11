import { MODULE_METADATA } from '@nestjs/common/constants';
import { S3SubmissionFileStorage } from '../submissions/s3-submission-file.storage';
import { SubmissionFileStorageConfig } from '../submissions/submission-file-storage.config';
import { SUBMISSION_FILE_STORAGE } from '../submissions/submission-file-storage.port';
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
import { MilestoneDocumentsModule } from './milestone-documents.module';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';
import { MilestoneDocumentsStaffGuard } from './milestone-documents-staff.guard';

/**
 * MilestoneDocumentsController가 생성자에서 MilestoneDocumentFilesService를 요구하고,
 * MilestoneDocumentFilesService가 SUBMISSION_FILE_STORAGE를 요구하는데도 모듈 provider
 * 목록에서 빠져 있었던 회귀(부트스트랩 DI 실패)를 다시 만들지 않도록 메타데이터를 고정한다.
 * 같은 컨트롤러가 이제 MilestoneDocumentReviewsService도 요구하므로 함께 고정한다.
 */
describe('MilestoneDocumentsModule', () => {
  const getMetadataArray = (key: string): unknown[] => {
    const metadata: unknown = Reflect.getMetadata(
      key,
      MilestoneDocumentsModule,
    );
    expect(Array.isArray(metadata)).toBe(true);
    return Array.isArray(metadata) ? metadata : [];
  };

  it('두 컨트롤러(/milestones/:id/documents, /milestone-document-files)를 모두 등록한다', () => {
    const controllers = getMetadataArray(MODULE_METADATA.CONTROLLERS);

    expect(controllers).toEqual(
      expect.arrayContaining([
        MilestoneDocumentsController,
        MilestoneDocumentFilesController,
        MilestoneDocumentCurrentFileController,
      ]),
    );
  });

  it('MilestoneDocumentFilesService와 파일 저장 provider 체인을 등록한다', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    expect(providers).toEqual(
      expect.arrayContaining([
        MilestoneDocumentsService,
        MilestoneDocumentsRepository,
        MilestoneDocumentCurrentFileRepository,
        MilestoneDocumentCurrentFileService,
        MilestoneDocumentFilesService,
        MilestoneDocumentReviewsService,
        // 일괄 내려받기(ZIP)도 같은 컨트롤러가 생성자에서 요구한다 — 빠지면 부트스트랩 DI가
        // 실패한다(이 spec이 고정하는 회귀와 같은 모양이다).
        MilestoneDocumentArchiveService,
        MilestoneDocumentsStaffGuard,
        SubmissionFileStorageConfig,
        S3SubmissionFileStorage,
        expect.objectContaining({
          provide: SUBMISSION_FILE_STORAGE,
          inject: [S3SubmissionFileStorage],
        }),
      ]),
    );
  });

  it('E2E composition에 필요한 document services만 다른 모듈에 노출한다', () => {
    const exports = getMetadataArray(MODULE_METADATA.EXPORTS);

    expect(exports).toEqual([
      MilestoneDocumentsService,
      MilestoneDocumentFilesService,
      MilestoneDocumentCurrentFileService,
    ]);
  });
});

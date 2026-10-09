import { MODULE_METADATA } from '@nestjs/common/constants';
import { SubmissionFilesRepository } from '../submissions/submission-files.repository';
import {
  MilestoneDocumentFilesController,
  MilestoneDocumentsController,
} from './milestone-documents.controller';
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
import { MilestoneDocumentsModule } from './milestone-documents.module';
import { MilestoneDocumentsRepository } from './repository/milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';
import { MilestoneDocumentsStaffGuard } from './milestone-documents-staff.guard';

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
        MilestoneDocumentCollectionService,
        MilestoneDocumentCollectionReadRepository,
        MilestoneDocumentCurrentFileRepository,
        MilestoneDocumentCurrentFileService,
        MilestoneDocumentFilesService,
        MilestoneDocumentReviewsService,

        MilestoneDocumentArchiveService,
        MilestoneDocumentsStaffGuard,

        SubmissionFilesRepository,
      ]),
    );
  });

  it('학생 대시보드 피드백 API와 그 7일 창을 셀 현재 시각 시계를 등록한다', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const clock = providers.find(
      (provider): provider is { readonly useValue: () => Date } =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        provider.provide === MILESTONE_DOCUMENT_FEEDBACK_CLOCK,
    );

    expect(getMetadataArray(MODULE_METADATA.CONTROLLERS)).toContain(
      MilestoneDocumentFeedbackController,
    );
    expect(providers).toEqual(
      expect.arrayContaining([
        MilestoneDocumentFeedbackService,
        MilestoneDocumentFeedbackRepository,
      ]),
    );
    const before = Date.now();
    const now = clock?.useValue().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
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

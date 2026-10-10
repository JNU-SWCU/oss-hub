import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionsModule } from '../submissions/submissions.module';
import { SubmissionFilesService } from '../submissions/service/submission-files.service';
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
      ]),
    );
  });

  it('제출 파일 service는 provider 재등록 없이 SubmissionsModule import로 해결한다', () => {
    const imports = getMetadataArray(MODULE_METADATA.IMPORTS);
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    expect(imports).toContain(SubmissionsModule);
    expect(providers).not.toContain(SubmissionFilesService);
    expect(
      Reflect.getMetadata('design:paramtypes', MilestoneDocumentFilesService),
    ).toEqual([MilestoneDocumentsRepository, Object, SubmissionFilesService]);
  });

  it('E2E composition에 필요한 document services만 다른 모듈에 노출한다', () => {
    const exports = getMetadataArray(MODULE_METADATA.EXPORTS);

    expect(exports).toEqual([
      MilestoneDocumentsService,
      MilestoneDocumentFilesService,
      MilestoneDocumentCurrentFileService,
    ]);
  });

  it('외부 repository 재등록 없이 제출 파일 service 의존성을 조립한다', async () => {
    const module = await Test.createTestingModule({
      imports: [PrismaModule, MilestoneDocumentsModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthConfig)
      .useValue({})
      .compile();

    try {
      expect(module.get(MilestoneDocumentFilesService)).toBeInstanceOf(
        MilestoneDocumentFilesService,
      );
      expect(module.get(SubmissionFilesService)).toBeInstanceOf(
        SubmissionFilesService,
      );
    } finally {
      await module.close();
    }
  });
});

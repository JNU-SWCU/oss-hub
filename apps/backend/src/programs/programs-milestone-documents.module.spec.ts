import { MODULE_METADATA } from '@nestjs/common/constants';
import { PlatformModule } from '../platform/platform.module';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { PrismaService } from '../platform/prisma.service';
import { loadRuntimeConfig } from '../platform/runtime-config.config';
import { RUNTIME_CONFIG } from '../platform/runtime-config-instance.config';
import { SubmissionFilesService } from './submission-files.service';
import { UsersModule } from '../users/users.module';
import { MilestoneDocumentsController } from './milestone-documents.controller';
import { MilestoneDocumentFilesController } from './milestone-document-files.controller';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import {
  MilestoneDocumentCollectionService,
  MilestoneDocumentCurrentFileService,
} from './milestone-document-collection.service';
import { MilestoneDocumentCollectionReadRepository } from './milestone-document-collection-read.repository';
import { MilestoneDocumentCurrentFileRepository } from './milestone-document-current-file.repository';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { ProgramsModule } from './programs.module';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';

describe('ProgramsModule milestone documents', () => {
  const getMetadataArray = (key: string): unknown[] => {
    const metadata: unknown = Reflect.getMetadata(key, ProgramsModule);
    expect(Array.isArray(metadata)).toBe(true);
    return Array.isArray(metadata) ? metadata : [];
  };

  it('imports the users authority capability', () => {
    expect(getMetadataArray(MODULE_METADATA.IMPORTS)).toContain(UsersModule);
  });

  it('두 컨트롤러(/milestones/:id/documents, /milestone-document-files)를 모두 등록한다', () => {
    const controllers = getMetadataArray(MODULE_METADATA.CONTROLLERS);

    expect(controllers).toEqual(
      expect.arrayContaining([
        MilestoneDocumentsController,
        MilestoneDocumentFilesController,
        MilestoneDocumentsController,
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
      ]),
    );
  });

  it('제출 파일 service는 같은 ProgramsModule provider로 해결한다', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    expect(providers).toContain(SubmissionFilesService);
    expect(
      Reflect.getMetadata('design:paramtypes', MilestoneDocumentFilesService),
    ).toEqual([
      MilestoneDocumentsRepository,
      Object,
      SubmissionFilesService,
      Object,
    ]);
  });

  it('E2E composition에 필요한 document services만 다른 모듈에 노출한다', () => {
    const exports = getMetadataArray(MODULE_METADATA.EXPORTS);

    expect(exports).toEqual(
      expect.arrayContaining([
        MilestoneDocumentsService,
        MilestoneDocumentFilesService,
        MilestoneDocumentCurrentFileService,
      ]),
    );
  });

  it('외부 repository 재등록 없이 제출 파일 service 의존성을 조립한다', async () => {
    const module = await Test.createTestingModule({
      imports: [PlatformModule, ProgramsModule],
    })
      .overrideProvider(RUNTIME_CONFIG)
      .useValue(
        loadRuntimeConfig({
          SESSION_SECRET: Buffer.from(
            'synthetic-milestone-documents-session-secret',
          ).toString('base64url'),
          FRONTEND_URL: 'http://localhost:3000',
          GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
          GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
          GITHUB_OAUTH_CALLBACK_URL:
            'http://localhost:3000/api/v1/auth/github/callback',
          TEAM_JOIN_CODE_SECRET: 'synthetic-milestone-documents-secret',
          MAIL_MODE: 'dry-run',
        }),
      )
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

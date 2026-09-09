import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import {
  archiveId,
  type ProgramArchiveIntegrationFixture,
} from './milestone-document-archive.integration-fixture';
import {
  MilestoneDocumentArchiveService,
  type ProgramDocumentArchiveScope,
} from './milestone-document-archive.service';
import { MilestoneDocumentsStaffGuard } from './milestone-documents-staff.guard';
import { ProgramDocumentArchivesController } from './program-document-archives.controller';

export async function startArchiveHttp(
  fixture: ProgramArchiveIntegrationFixture,
) {
  const sessionSecret = new Uint8Array(32).fill(43);
  await fixture.prisma.user.update({
    where: { id: archiveId('user') },
    data: { hasStaffAccess: true },
  });
  const module = await Test.createTestingModule({
    controllers: [ProgramDocumentArchivesController],
    providers: [
      SessionGuard,
      MilestoneDocumentsStaffGuard,
      { provide: AuthConfig, useValue: { sessionSecret } },
      {
        provide: AuthService,
        useValue: { getMe: jest.fn().mockResolvedValue({ sessionVersion: 0 }) },
      },
      { provide: PrismaService, useValue: fixture.prisma },
      { provide: MilestoneDocumentArchiveService, useValue: fixture.service },
    ],
  }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new ProblemDetailFilter());
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const token = await issueSessionToken(sessionSecret, 960000001135099n, 0);
  return {
    close: () => app.close(),
    request: (
      scope: ProgramDocumentArchiveScope,
      authenticated = true,
      programId = archiveId('a'),
    ) => {
      const query = new URLSearchParams({ scope: scope.kind });
      if (scope.kind === 'TEAM') query.set('teamId', scope.teamId);
      if (scope.kind === 'MILESTONE')
        query.set('milestoneId', scope.milestoneId);
      return fetch(
        `${base}/api/v1/programs/${programId}/documents/collection/archive?${query}`,
        {
          headers: authenticated
            ? { cookie: `${sessionCookieName(false)}=${token}` }
            : {},
        },
      );
    },
  };
}

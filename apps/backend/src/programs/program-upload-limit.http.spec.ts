import { type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OriginGuard } from '../platform/origin.guard';
import { ProgramSubmissionsController } from './program-submissions.controller';
import { ProgramAuthoringController } from './program-authoring.controller';
import { ProgramAuthoringRepository } from './programs.repository';
import { ProgramAuthoringService } from './programs.service';
import { ProgramAuthoringUploadService } from './files.service';
import { STATELESS_PROVIDERS } from '../../test/stateless-providers.fixture';
import { protectedRouteGuardStub } from '../../test/global-authentication-guard.fixture';

jest.mock('./submission-upload.config', () => ({
  ...jest.requireActual<Record<string, unknown>>('./submission-upload.config'),
  SUBMISSION_UPLOAD_MAX_BYTES: 2 * 1024 * 1024,
  SUBMISSION_UPLOAD_MAX_LABEL: '2 MB',
}));
let application: INestApplication;
let baseUrl = '';
let authenticated = true;
let staff = true;
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramAuthoringController, ProgramSubmissionsController],
    providers: [
      protectedRouteGuardStub({
        canActivate(context: ExecutionContext): boolean {
          Object.assign(context.switchToHttp().getRequest<object>(), {
            sessionGithubId: 999001n,
            principal: {
              id: 'synthetic-author',
              hasStaffAccess: staff,
              hasAdminAccess: false,
            },
          });
          return authenticated;
        },
      }),
      ...STATELESS_PROVIDERS,
      ProgramAuthoringService,
      { provide: ProgramAuthoringUploadService, useValue: {} },
      { provide: ProgramAuthoringRepository, useValue: {} },
    ],
  })
    .useMocker((token) => (token === Function ? undefined : {}))
    .overrideGuard(OriginGuard)
    .useValue({ canActivate: () => true })
    .compile();
  application = moduleRef.createNestApplication();
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
});
beforeEach(() => {
  authenticated = true;
  staff = true;
});
afterAll(async () => {
  await application.close();
});
it.each(['/program-authoring/upload-policy'])(
  '%s는 실제 서버 상한을 응답한다',
  async (path) => {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        fileUpload: { maxBytes: 2 * 1024 * 1024, maxLabel: '2 MB' },
      }),
    );
  },
);
it('프로그램 작성 정책은 로그인하지 않은 요청에 열리지 않는다', async () => {
  authenticated = false;
  const response = await fetch(`${baseUrl}/program-authoring/upload-policy`);
  expect(response.status).toBe(403);
});
it('프로그램 작성 정책은 작성 권한이 없는 학생에게 열리지 않는다', async () => {
  staff = false;
  const response = await fetch(`${baseUrl}/program-authoring/upload-policy`);
  expect(response.status).toBe(409);
});

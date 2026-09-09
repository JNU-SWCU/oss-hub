import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SessionGuard } from '../auth/session.guard';
import { OriginGuard } from '../auth/origin.guard';
import {
  SubmissionChecklistController,
  SubmissionFormsController,
} from '../submissions/submissions.controller';
import { SubmissionsRepository } from '../submissions/submissions.repository';
import { SubmissionsService } from '../submissions/submissions.service';
import { ProgramAuthoringController } from './controller/program-authoring.controller';
import { ProgramAuthoringRepository } from './program-authoring.repository';
import { ProgramAuthoringService } from './program-authoring.service';
import { ProgramAuthoringUploadService } from './program-authoring-upload.service';

jest.mock('../submissions/submission-upload-policy', () => ({
  ...jest.requireActual<Record<string, unknown>>(
    '../submissions/submission-upload-policy',
  ),
  SUBMISSION_UPLOAD_MAX_BYTES: 2 * 1024 * 1024,
  SUBMISSION_UPLOAD_MAX_LABEL: '2 MB',
}));

let application: INestApplication;
let baseUrl = '';
let authenticated = true;
let staff = true;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      ProgramAuthoringController,
      SubmissionFormsController,
      SubmissionChecklistController,
    ],
    providers: [
      SubmissionsService,
      { provide: ProgramAuthoringService, useValue: {} },
      { provide: ProgramAuthoringUploadService, useValue: {} },
      {
        provide: ProgramAuthoringRepository,
        useValue: {
          findActor: () =>
            Promise.resolve({
              id: 'synthetic-author',
              accountStatus: 'ACTIVE',
              hasStaffAccess: staff,
              hasAdminAccess: false,
            }),
        },
      },
      {
        provide: SubmissionsRepository,
        useValue: {
          findActiveStudentByGithubId: () =>
            Promise.resolve({
              id: 'synthetic-student',
            }),
          findMilestoneByProgram: () =>
            Promise.resolve({
              id: 'synthetic-milestone',
              name: '합성 마일스톤',
              dueAt: new Date('2099-01-01T00:00:00Z'),
              submissionType: 'FILE',
              instructions: null,
              programEndAt: new Date('2099-02-01T00:00:00Z'),
            }),
          findParticipantApplication: () =>
            Promise.resolve({
              id: 'synthetic-application',
              status: 'APPROVED',
              teamMemberCount: 1,
              existingSubmission: null,
            }),
          findChecklistApplication: () =>
            Promise.resolve({
              id: 'synthetic-application',
              status: 'APPROVED',
              teamMemberCount: 1,
            }),
          listChecklistMilestones: () => Promise.resolve([]),
        },
      },
    ],
  })
    .overrideGuard(SessionGuard)
    .useValue({
      canActivate(context: ExecutionContext): boolean {
        context
          .switchToHttp()
          .getRequest<{ sessionGithubId: bigint }>().sessionGithubId = 999_001n;
        return authenticated;
      },
    })
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

it.each([
  '/program-authoring/upload-policy',
  '/programs/synthetic-program/milestones/synthetic-milestone/submission-form',
  '/programs/synthetic-program/submissions/me',
])('%s는 실제 서버 상한을 응답한다', async (path) => {
  const response = await fetch(`${baseUrl}${path}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(
    expect.objectContaining({
      fileUpload: { maxBytes: 2 * 1024 * 1024, maxLabel: '2 MB' },
    }),
  );
});

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

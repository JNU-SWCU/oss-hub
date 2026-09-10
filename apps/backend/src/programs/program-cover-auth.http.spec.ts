import { Readable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuthenticationGuard } from '../auth/authentication.guard';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { ProgramAuthoringController } from './controller/program-authoring.controller';
import { ProgramCoverController } from './controller/program-cover.controller';
import { ProgramAuthoringRepository } from './program-authoring.repository';
import { ProgramAuthoringService } from './program-authoring.service';
import { ProgramAuthoringUploadService } from './program-authoring-upload.service';
import { ProgramCoverService } from './service/program-cover.service';

let application: INestApplication;
let baseUrl = '';
const bytes = Buffer.from('public-cover');
const read = jest.fn(() =>
  Promise.resolve({
    body: Readable.from(bytes),
    contentType: 'image/png',
    size: bytes.length,
  }),
);
const uploadCover = jest.fn();

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramAuthoringController, ProgramCoverController],
    providers: [
      { provide: APP_GUARD, useClass: AuthenticationGuard },
      { provide: AuthConfig, useValue: { useSecureCookies: false } },
      { provide: AuthService, useValue: {} },
      { provide: ProgramAuthoringService, useValue: {} },
      { provide: ProgramAuthoringRepository, useValue: {} },
      { provide: ProgramAuthoringUploadService, useValue: { uploadCover } },
      { provide: ProgramCoverService, useValue: { read } },
    ],
  }).compile();
  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
});

afterAll(() => application.close());

it('allows anonymous cover reads through the real global authentication guard', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/programs/program/cover/current`,
  );
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  expect(read).toHaveBeenCalledWith('program', 'current');
});

it('keeps anonymous cover uploads protected by the global authentication guard', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/program-authoring/cover-uploads`,
    {
      method: 'POST',
    },
  );
  expect(response.status).toBe(401);
  expect(uploadCover).not.toHaveBeenCalled();
});

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ApplicationStatus } from '@prisma/client';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import type { ApplicationsService } from './applications.service';
import { CreateApplicationRequestDto } from './dto/create-application-request.dto';
import { ProgramApplicationsController } from './program-applications.controller';

function readGuards(target: object, methodName: 'create'): unknown[] {
  const method: unknown = Object.getOwnPropertyDescriptor(
    target,
    methodName,
  )?.value;
  if (typeof method !== 'function') return [];
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, method);
  return Array.isArray(guards) ? guards : [];
}

describe('ProgramApplicationsController', () => {
  it('POST 에 SessionGuard·OriginGuard 를 적용한다', () => {
    expect(
      readGuards(ProgramApplicationsController.prototype, 'create'),
    ).toEqual([SessionGuard, OriginGuard]);
  });

  it('세션·programId·body 를 service.create 로 넘기고 201 응답 DTO 를 반환한다', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'synthetic-application',
      programId: 'synthetic-program',
      status: ApplicationStatus.SUBMITTED,
      teamId: null,
      submittedAt: new Date('2026-07-15T00:00:00.000Z'),
    });
    const service: Pick<ApplicationsService, 'create'> = { create };
    const controller = new ProgramApplicationsController(service);
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      teamId: null,
      applicationTemplateVersion: 1,
    });

    const response = await controller.create(
      { sessionGithubId: 4242n },
      'synthetic-program',
      body,
    );

    expect(create).toHaveBeenCalledWith(4242n, 'synthetic-program', {
      answers: { title: '제목', summary: '요약' },
      teamId: null,
      applicationTemplateVersion: 1,
    });
    expect(response).toEqual({
      id: 'synthetic-application',
      programId: 'synthetic-program',
      status: ApplicationStatus.SUBMITTED,
      teamId: null,
      submittedAt: '2026-07-15T00:00:00.000Z',
    });
  });
});

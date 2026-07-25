import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ApplicationStatus } from '@prisma/client';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { ApplicationsStaffListGuard } from './applications-staff.guard';
import type { ApplicationsService } from './applications.service';
import { ApplicationListQueryRequestDto } from './dto/application-list-query.dto';
import { CreateApplicationRequestDto } from './dto/create-application-request.dto';
import { ProgramApplicationsController } from './program-applications.controller';

function readGuards(target: object, methodName: 'create' | 'list'): unknown[] {
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

  it('GET 에 SessionGuard·ApplicationsStaffListGuard 를 적용한다', () => {
    expect(readGuards(ProgramApplicationsController.prototype, 'list')).toEqual(
      [SessionGuard, ApplicationsStaffListGuard],
    );
  });

  it('세션·programId·body 를 service.create 로 넘기고 201 응답 DTO 를 반환한다', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'synthetic-application',
      programId: 'synthetic-program',
      status: ApplicationStatus.SUBMITTED,
      teamId: null,
      submittedAt: new Date('2026-07-15T00:00:00.000Z'),
    });
    const service: Pick<ApplicationsService, 'create' | 'listForProgram'> = {
      create,
      listForProgram: jest.fn(),
    };
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

  it('programId·query 를 service.listForProgram 으로 넘기고 페이지 DTO 를 반환한다', async () => {
    const listForProgram = jest.fn().mockResolvedValue({
      items: [
        {
          id: 'synthetic-application',
          status: ApplicationStatus.SUBMITTED,
          submittedAt: new Date('2026-07-15T00:00:00.000Z'),
          participation: 'INDIVIDUAL' as const,
          applicant: {
            id: 'synthetic-student',
            name: '합성 학생',
            nickname: 'synthetic-login',
          },
          team: null,
          answers: {
            applicantName: '합성 학생',
            title: '제목',
            summary: '요약',
          },
        },
      ],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });
    const service: Pick<ApplicationsService, 'create' | 'listForProgram'> = {
      create: jest.fn(),
      listForProgram,
    };
    const controller = new ProgramApplicationsController(service);
    const query = Object.assign(new ApplicationListQueryRequestDto(), {
      page: 1,
      pageSize: 20,
      search: '합성',
      status: 'SUBMITTED' as const,
      mode: 'personal' as const,
    });

    const response = await controller.list('synthetic-program', query);

    expect(listForProgram).toHaveBeenCalledWith('synthetic-program', {
      page: 1,
      pageSize: 20,
      search: '합성',
      status: 'SUBMITTED',
      mode: 'personal',
    });
    expect(response).toEqual({
      items: [
        {
          id: 'synthetic-application',
          status: ApplicationStatus.SUBMITTED,
          submittedAt: '2026-07-15T00:00:00.000Z',
          participation: 'INDIVIDUAL',
          applicant: {
            id: 'synthetic-student',
            name: '합성 학생',
            nickname: 'synthetic-login',
          },
          team: null,
          answers: {
            applicantName: '합성 학생',
            title: '제목',
            summary: '요약',
          },
        },
      ],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });
  });
});

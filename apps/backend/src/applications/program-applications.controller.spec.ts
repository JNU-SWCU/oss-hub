import { RepositoryConnectionMode } from '@prisma/client';
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
      teamId: 'synthetic-team',
      submittedAt: new Date('2026-07-15T00:00:00.000Z'),
      isRepositoryPublicationPlanned: true,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
    });
    const service: Pick<ApplicationsService, 'create' | 'listForProgram'> = {
      create,
      listForProgram: jest.fn(),
    };
    const controller = new ProgramApplicationsController(service);
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      applicationTemplateVersion: 1,
    });

    const response = await controller.create(
      { sessionGithubId: 4242n },
      'synthetic-program',
      body,
    );

    expect(create).toHaveBeenCalledWith(4242n, 'synthetic-program', {
      answers: { title: '제목', summary: '요약' },
      teamName: null,
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
    });
    expect(response).toEqual({
      id: 'synthetic-application',
      programId: 'synthetic-program',
      status: ApplicationStatus.SUBMITTED,
      teamId: 'synthetic-team',
      submittedAt: '2026-07-15T00:00:00.000Z',
      isRepositoryPublicationPlanned: true,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
    });
  });

  it('구 클라이언트가 isRepositoryPublicationPlanned 를 생략하면 true 로 기본 설정해 service.create 에 전달한다', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'synthetic-application',
      programId: 'synthetic-program',
      status: ApplicationStatus.SUBMITTED,
      teamId: 'synthetic-team',
      submittedAt: new Date('2026-07-15T00:00:00.000Z'),
      isRepositoryPublicationPlanned: true,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
    });
    const service: Pick<ApplicationsService, 'create' | 'listForProgram'> = {
      create,
      listForProgram: jest.fn(),
    };
    const controller = new ProgramApplicationsController(service);
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      applicationTemplateVersion: 1,
    });
    delete (body as { isRepositoryPublicationPlanned?: boolean })
      .isRepositoryPublicationPlanned;

    await controller.create(
      { sessionGithubId: 4242n },
      'synthetic-program',
      body,
    );

    expect(create).toHaveBeenCalledWith(
      4242n,
      'synthetic-program',
      expect.objectContaining({ isRepositoryPublicationPlanned: true }),
    );
  });

  it('명시적 isRepositoryPublicationPlanned=false 를 그대로 service.create 에 전달한다', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'synthetic-application',
      programId: 'synthetic-program',
      status: ApplicationStatus.SUBMITTED,
      teamId: 'synthetic-team',
      submittedAt: new Date('2026-07-15T00:00:00.000Z'),
      isRepositoryPublicationPlanned: false,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
    });
    const service: Pick<ApplicationsService, 'create' | 'listForProgram'> = {
      create,
      listForProgram: jest.fn(),
    };
    const controller = new ProgramApplicationsController(service);
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: false,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
    });

    const response = await controller.create(
      { sessionGithubId: 4242n },
      'synthetic-program',
      body,
    );

    expect(create).toHaveBeenCalledWith(
      4242n,
      'synthetic-program',
      expect.objectContaining({ isRepositoryPublicationPlanned: false }),
    );
    expect(response).toMatchObject({ isRepositoryPublicationPlanned: false });
  });

  it('teamName 을 service.create 입력으로 전달한다', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'synthetic-application',
      programId: 'synthetic-program',
      status: ApplicationStatus.SUBMITTED,
      teamId: 'synthetic-team',
      submittedAt: new Date('2026-07-15T00:00:00.000Z'),
      isRepositoryPublicationPlanned: true,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
    });
    const service: Pick<ApplicationsService, 'create' | 'listForProgram'> = {
      create,
      listForProgram: jest.fn(),
    };
    const controller = new ProgramApplicationsController(service);
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      applicationTemplateVersion: 1,
      teamName: '  오픈소스팀  ',
    });

    await controller.create(
      { sessionGithubId: 4242n },
      'synthetic-program',
      body,
    );

    expect(create).toHaveBeenCalledWith(
      4242n,
      'synthetic-program',
      expect.objectContaining({ teamName: '오픈소스팀' }),
    );
  });

  it('programId·query 를 service.listForProgram 으로 넘기고 페이지 DTO 를 반환한다', async () => {
    const listForProgram = jest.fn().mockResolvedValue({
      items: [
        {
          id: 'synthetic-application',
          status: ApplicationStatus.SUBMITTED,
          submittedAt: new Date('2026-07-15T00:00:00.000Z'),
          rejectionReason: '합성 사유',
          repositoryProvisioning: {
            enabled: false,
            jobStatus: 'DISABLED' as const,
            updatedAt: new Date('2026-07-15T01:00:00.000Z'),
            safeErrorClass: null,
          },
          isRepositoryPublicationPlanned: false,
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
          rejectionReason: '합성 사유',
          repositoryProvisioning: {
            enabled: false,
            jobStatus: 'DISABLED',
            updatedAt: '2026-07-15T01:00:00.000Z',
            safeErrorClass: null,
          },
          isRepositoryPublicationPlanned: false,
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

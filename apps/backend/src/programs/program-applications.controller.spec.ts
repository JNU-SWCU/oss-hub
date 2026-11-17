import { RepositoryConnectionMode, ApplicationStatus } from '@prisma/client';
import { RolesGuard } from '../platform/roles.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OriginGuard } from '../platform/origin.guard';
import { TeamApplicationService } from './team-application.service';
import { CreateApplicationRequestDto } from './dto/create-application-request.dto';
import { ProgramApplicationsController } from './teams.controller';

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
  it('POST 에 OriginGuard 를 적용한다', () => {
    expect(
      readGuards(ProgramApplicationsController.prototype, 'create'),
    ).toEqual([OriginGuard]);
  });

  it('GET 에는 역할 가드만 둔다', () => {
    expect(readGuards(ProgramApplicationsController.prototype, 'list')).toEqual(
      [RolesGuard],
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
    });
    const service = Object.assign(
      Object.create(TeamApplicationService.prototype) as object,
      {
        create,
        listForProgram: jest.fn(),
        listTeamManagementForProgram: jest.fn(),
      },
    ) as unknown as TeamApplicationService;
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
      inviteeUserIds: [],
      answers: { title: '제목', summary: '요약' },
      teamName: null,
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
    });
    expect(response).toEqual({
      id: 'synthetic-application',
      programId: 'synthetic-program',
      status: ApplicationStatus.SUBMITTED,
      teamId: 'synthetic-team',
      submittedAt: '2026-07-15T00:00:00.000Z',
      isRepositoryPublicationPlanned: true,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
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
    });
    const service = Object.assign(
      Object.create(TeamApplicationService.prototype) as object,
      {
        create,
        listForProgram: jest.fn(),
        listTeamManagementForProgram: jest.fn(),
      },
    ) as unknown as TeamApplicationService;
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
    });
    const service = Object.assign(
      Object.create(TeamApplicationService.prototype) as object,
      {
        create,
        listForProgram: jest.fn(),
        listTeamManagementForProgram: jest.fn(),
      },
    ) as unknown as TeamApplicationService;
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
    });
    const service = Object.assign(
      Object.create(TeamApplicationService.prototype) as object,
      {
        create,
        listForProgram: jest.fn(),
        listTeamManagementForProgram: jest.fn(),
      },
    ) as unknown as TeamApplicationService;
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
});

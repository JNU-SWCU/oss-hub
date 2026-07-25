import { ApplicationStatus, ProgramCategory } from '@prisma/client';
import type {
  ApplicationListPage,
  ApplicationsRepository,
  ApplyProgramRecord,
} from './applications.repository';
import { ApplicationsErrorCode } from './applications-error-code.enum';
import { ApplicationsService } from './applications.service';

const PROGRAM_ID = 'synthetic-program';

const OPEN_PROGRAM: ApplyProgramRecord = {
  id: PROGRAM_ID,
  category: ProgramCategory.BASIC,
  applicationTemplateVersion: 1,
  applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
  applicationEndAt: new Date('2026-07-31T23:59:59.000Z'),
};

const EMPTY_PAGE: ApplicationListPage = {
  items: [],
  page: 1,
  pageSize: 20,
  totalItems: 0,
  totalPages: 0,
};

describe('ApplicationsService.listForProgram', () => {
  it('프로그램이 없으면 404 를 던진다', async () => {
    const listApplicationsForProgram = jest.fn();
    const repository = {
      findProgramById: jest.fn().mockResolvedValue(null),
      listApplicationsForProgram,
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(repository);

    await expect(
      service.listForProgram(PROGRAM_ID, {
        page: 1,
        pageSize: 20,
        search: '',
        status: 'all',
        mode: 'all',
      }),
    ).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.PROGRAM_NOT_FOUND,
        status: 404,
      },
    });
    expect(listApplicationsForProgram).not.toHaveBeenCalled();
  });

  it('프로그램이 있으면 repository 목록을 그대로 반환한다', async () => {
    const page: ApplicationListPage = {
      items: [
        {
          id: 'app-1',
          status: ApplicationStatus.SUBMITTED,
          submittedAt: new Date('2026-07-15T00:00:00.000Z'),
          participation: 'INDIVIDUAL',
          applicant: {
            id: 'student-1',
            name: '합성 학생',
            nickname: 'login-1',
          },
          team: null,
          answers: {
            applicantName: '합성 학생',
            title: '제목',
            summary: '요약',
          },
        },
        {
          id: 'app-2',
          status: ApplicationStatus.APPROVED,
          submittedAt: new Date('2026-07-16T00:00:00.000Z'),
          participation: 'TEAM',
          applicant: {
            id: 'student-2',
            name: '팀장',
            nickname: 'leader',
          },
          team: { id: 'team-1', name: '합성 팀', memberCount: 3 },
          answers: {
            applicantName: '팀장',
            title: '팀 제목',
            summary: '팀 요약',
          },
        },
      ],
      page: 2,
      pageSize: 10,
      totalItems: 12,
      totalPages: 2,
    };
    const listApplicationsForProgram = jest.fn().mockResolvedValue(page);
    const repository = {
      findProgramById: jest.fn().mockResolvedValue(OPEN_PROGRAM),
      listApplicationsForProgram,
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(repository);
    const query = {
      page: 2,
      pageSize: 10,
      search: '합성',
      status: 'SUBMITTED' as const,
      mode: 'personal' as const,
    };

    await expect(service.listForProgram(PROGRAM_ID, query)).resolves.toEqual(
      page,
    );
    expect(listApplicationsForProgram).toHaveBeenCalledWith(PROGRAM_ID, query);
    expect(page.items[0]?.team).toBeNull();
    expect(page.items[1]?.team?.name).toBe('합성 팀');
  });

  it('빈 목록도 페이지 메타를 유지한다', async () => {
    const repository = {
      findProgramById: jest.fn().mockResolvedValue(OPEN_PROGRAM),
      listApplicationsForProgram: jest.fn().mockResolvedValue(EMPTY_PAGE),
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(repository);

    await expect(
      service.listForProgram(PROGRAM_ID, {
        page: 1,
        pageSize: 20,
        search: '',
        status: 'all',
        mode: 'all',
      }),
    ).resolves.toEqual(EMPTY_PAGE);
  });
});

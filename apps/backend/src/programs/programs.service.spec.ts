import { ProgramCategory, Role, SubmissionStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { programDeadline } from './program-deadline';
import type { ProgramViewer } from './program-viewer.service';
import { ProgramsService } from './programs.service';

const publicProgram = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizer: '운영기관',
  category: ProgramCategory.OSS_CONTEST,
  description: '프로그램 설명',
  applicationStartAt: new Date('2026-07-01T00:00:00+09:00'),
  applicationEndAt: new Date('2026-08-31T23:59:59+09:00'),
  milestones: [
    {
      id: 'today',
      name: '오늘 제출',
      dueAt: new Date('2026-07-21T23:59:59+09:00'),
      instructions: '설명',
      submissionType: 'FILE',
    },
    {
      id: 'overdue',
      name: '지난 제출',
      dueAt: new Date('2026-07-20T23:59:59+09:00'),
      instructions: null,
      submissionType: 'TEXT',
    },
  ],
};

function createService() {
  const findUnique = jest.fn().mockResolvedValue(publicProgram);
  const findFirst = jest.fn();
  const findMany = jest.fn();
  const prisma = {
    program: { findUnique },
    application: { findFirst, findMany },
  } as unknown as PrismaService;
  return {
    service: new ProgramsService(prisma),
    findUnique,
    findFirst,
    findMany,
  };
}

const anonymous: ProgramViewer = { githubId: null, userId: null, role: null };

describe('ProgramsService detail', () => {
  it('비로그인은 공개 정보만 조회하고 비공개 상태를 null로 반환한다', async () => {
    const { service, findFirst, findMany } = createService();
    const detail = await service.detail(
      'program-1',
      anonymous,
      new Date('2026-07-21T01:00:00+09:00'),
    );

    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(detail.viewer).toEqual({ role: null, applicationStatus: null });
    expect(detail.milestones[0]?.viewerSubmissionStatus).toBeNull();
    expect(detail.milestones[0]?.deadlineLabel).toBe('오늘 마감');
    expect(detail.milestones[1]?.deadlineLabel).toBe('마감 지남');
  });

  it('승인된 학생에게 마일스톤별 현재 제출 상태를 반환한다', async () => {
    const { service, findFirst } = createService();
    findFirst.mockResolvedValue({
      id: 'application-1',
      status: 'APPROVED',
      submissions: [
        { milestoneId: 'today', status: SubmissionStatus.REJECTED },
      ],
    });
    const viewer: ProgramViewer = {
      githubId: 1n,
      userId: 'student-1',
      role: Role.STUDENT,
    };
    const detail = await service.detail('program-1', viewer);

    expect(detail.milestones[0]?.viewerSubmissionStatus).toBe('REJECTED');
    expect(detail.milestones[1]?.viewerSubmissionStatus).toBe('NOT_SUBMITTED');
  });

  it('교직원에게 application 기준 제출 요약을 반환한다', async () => {
    const { service, findMany } = createService();
    findMany.mockResolvedValue([
      {
        submissions: [
          { milestoneId: 'today', status: SubmissionStatus.SUBMITTED },
        ],
      },
      {
        submissions: [
          { milestoneId: 'today', status: SubmissionStatus.CHANGES_REQUESTED },
        ],
      },
      { submissions: [] },
    ]);
    const viewer: ProgramViewer = {
      githubId: 2n,
      userId: 'staff-1',
      role: Role.STAFF,
    };
    const detail = await service.detail('program-1', viewer);

    expect(detail.milestones[0]?.applicationSubmissionSummary).toEqual({
      notSubmitted: 1,
      submitted: 1,
      approved: 0,
      changesRequested: 1,
      rejected: 0,
      total: 3,
    });
  });
});

describe('programDeadline', () => {
  it('Asia/Seoul 달력 날짜를 기준으로 D-day를 계산한다', () => {
    expect(
      programDeadline(
        new Date('2026-07-22T00:01:00+09:00'),
        new Date('2026-07-21T23:59:00+09:00'),
      ),
    ).toEqual({ dDay: 1, label: 'D-1' });
  });
});

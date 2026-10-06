import {
  ApplicationStatus,
  MilestoneDocumentKind,
  ProgramCategory,
  SubmissionStatus,
  ProgramTrackType,
} from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { hasProgramDeadlinePassed, programDeadline } from '../program-deadline';
import type { ProgramViewer } from './program-viewer.service';
import { ProgramsRepository } from '../repository/programs.repository';
import { ProgramsService } from './programs.service';

const publicProgram = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizer: '운영기관',
  trackType: ProgramTrackType.EXTRACURRICULAR,
  category: ProgramCategory.BASIC,
  lifecycle: 'PUBLISHED' as const,
  description: '프로그램 설명',
  repositoryProvisioningEnabled: true,
  applicationStartAt: new Date('2026-07-01T00:00:00+09:00'),
  applicationEndAt: new Date('2026-08-31T23:59:59+09:00'),
  startAt: new Date('2026-09-01T00:00:00+09:00'),
  endAt: new Date('2026-12-31T00:00:00+09:00'),
  milestones: [
    {
      id: 'today',
      name: '오늘 제출',
      startAt: new Date('2026-07-01T00:00:00+09:00'),
      dueAt: new Date('2026-07-21T23:59:59+09:00'),
      instructions: '설명',
      submissionType: 'FILE',
      documents: [],
      _count: { documents: 0 },
    },
    {
      id: 'overdue',
      name: '지난 제출',
      startAt: new Date('2026-07-01T00:00:00+09:00'),
      dueAt: new Date('2026-07-20T23:59:59+09:00'),
      instructions: null,
      submissionType: 'TEXT',
      documents: [],
      _count: { documents: 0 },
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
    service: new ProgramsService(new ProgramsRepository(prisma)),
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
    expect(detail.repositoryProvisioningEnabled).toBe(true);
    expect(detail.milestones[0]?.viewerSubmissionStatus).toBeNull();
    expect(detail.milestones[0]?.deadlineLabel).toBe('오늘 마감');
    expect(detail.milestones[1]?.deadlineLabel).toBe('마감 지남');
  });

  it('ARCHIVED 프로그램도 공개 상세 읽기를 허용한다', async () => {
    const { service, findUnique } = createService();
    findUnique.mockResolvedValue({
      ...publicProgram,
      lifecycle: 'ARCHIVED' as const,
    });

    await expect(service.detail('program-1', anonymous)).resolves.toMatchObject(
      {
        id: 'program-1',
        name: 'OSS 경진대회',
      },
    );
  });

  it.each(['PUBLISHED', 'ARCHIVED'] as const)(
    '%s 상세 응답에 게시 상태를 함께 싣는다',
    async (lifecycle) => {
      const { service, findUnique } = createService();
      findUnique.mockResolvedValue({ ...publicProgram, lifecycle });

      const detail = await service.detail('program-1', anonymous);

      expect(detail.lifecycle).toBe(lifecycle);
    },
  );

  it('종료 판정이 쓰는 게시 상태와 운영 종료일을 함께 싣는다', async () => {
    const { service } = createService();

    const detail = await service.detail('program-1', anonymous);

    expect(detail.lifecycle).toBe('PUBLISHED');
    expect(detail.operatingPeriod.endsAt).toBe(
      publicProgram.endAt.toISOString(),
    );
  });

  it('승인된 학생에게 마일스톤별 현재 제출 상태를 반환한다', async () => {
    const { service, findFirst } = createService();
    findFirst.mockResolvedValue({
      id: 'application-1',
      status: 'APPROVED',
      milestoneDocumentSubmissions: [
        {
          status: SubmissionStatus.REJECTED,
          milestoneDocument: {
            id: 'today-internal-submission',
            milestoneId: 'today',
            kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
          },
        },
      ],
    });
    const viewer: ProgramViewer = {
      githubId: 1n,
      userId: 'student-1',
      role: 'STUDENT',
    };
    const detail = await service.detail('program-1', viewer);

    expect(detail.milestones[0]?.viewerSubmissionStatus).toBe('REJECTED');
    expect(detail.milestones[1]?.viewerSubmissionStatus).toBe('NOT_SUBMITTED');
  });

  it('현재 팀원(팀장 포함)은 멤버십 절 하나로 자기 신청 상태를 조회한다', async () => {
    const { service, findFirst } = createService();
    findFirst.mockResolvedValue({
      id: 'application-1',
      status: ApplicationStatus.APPROVED,
      milestoneDocumentSubmissions: [],
    });
    const viewer: ProgramViewer = {
      githubId: 1n,
      userId: 'leader-1',
      role: 'STUDENT',
    };

    const detail = await service.detail('program-1', viewer);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        programId: 'program-1',
        team: { members: { some: { userId: 'leader-1' } } },
      },
      select: {
        id: true,
        status: true,
        milestoneDocumentSubmissions: {
          select: {
            status: true,
            milestoneDocument: {
              select: { id: true, milestoneId: true, kind: true },
            },
          },
        },
      },
    });
    expect(detail.viewer.applicationStatus).toBe(ApplicationStatus.APPROVED);
  });

  it('팀을 떠난 사람의 조회에는 최초 신청자·맨 leaderId 절을 남기지 않는다', async () => {
    const { service, findFirst } = createService();
    findFirst.mockResolvedValue(null);
    const viewer: ProgramViewer = {
      githubId: 9n,
      userId: 'ex-member-1',
      role: 'STUDENT',
    };

    const detail = await service.detail('program-1', viewer);

    const [{ where }] = findFirst.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(Object.keys(where).sort()).toEqual(['programId', 'team']);
    expect(where).not.toHaveProperty('OR');
    expect(where).not.toHaveProperty('applicantId');
    expect(where.team).toEqual({
      members: { some: { userId: 'ex-member-1' } },
    });
    expect(detail.viewer.applicationStatus).toBeNull();
    expect(detail.milestones[0]?.viewerSubmissionStatus).toBeNull();
  });
  it('교직원에게 application 기준 제출 요약을 반환한다', async () => {
    const { service, findMany } = createService();
    findMany.mockResolvedValue([
      {
        milestoneDocumentSubmissions: [
          {
            status: SubmissionStatus.SUBMITTED,
            milestoneDocument: {
              id: 'today-internal-submission-1',
              milestoneId: 'today',
              kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
            },
          },
        ],
      },
      {
        milestoneDocumentSubmissions: [
          {
            status: SubmissionStatus.CHANGES_REQUESTED,
            milestoneDocument: {
              id: 'today-internal-submission-2',
              milestoneId: 'today',
              kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
            },
          },
        ],
      },
      { milestoneDocumentSubmissions: [] },
    ]);
    const viewer: ProgramViewer = {
      githubId: 2n,
      userId: 'staff-1',
      role: 'STAFF',
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
  it('교직원 제출 요약은 승인된 신청만 분모에 포함한다', async () => {
    const { service, findMany } = createService();
    findMany.mockResolvedValue([{ milestoneDocumentSubmissions: [] }]);

    const viewer: ProgramViewer = {
      githubId: 2n,
      userId: 'staff-1',
      role: 'STAFF',
    };

    const detail = await service.detail('program-1', viewer);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        programId: 'program-1',
        status: ApplicationStatus.APPROVED,
      },
      select: {
        milestoneDocumentSubmissions: {
          select: {
            status: true,
            milestoneDocument: {
              select: { id: true, milestoneId: true, kind: true },
            },
          },
        },
      },
    });
    expect(detail.milestones[0]?.applicationSubmissionSummary).toEqual(
      expect.objectContaining({ total: 1, notSubmitted: 1 }),
    );
  });

  it('서류만 받는 마일스톤도 학생 진행에 반영한다 (#820)', async () => {
    const { service, findUnique, findFirst } = createService();
    findUnique.mockResolvedValue(programWithRequiredDocuments());
    findFirst.mockResolvedValue({
      id: 'application-1',
      status: ApplicationStatus.APPROVED,
      milestoneDocumentSubmissions: [
        {
          status: SubmissionStatus.APPROVED,
          milestoneDocument: {
            id: 'doc-1',
            milestoneId: 'today',
            kind: MilestoneDocumentKind.DOCUMENT,
          },
        },
        {
          status: SubmissionStatus.APPROVED,
          milestoneDocument: {
            id: 'doc-2',
            milestoneId: 'today',
            kind: MilestoneDocumentKind.DOCUMENT,
          },
        },
      ],
    });
    const viewer: ProgramViewer = {
      githubId: 1n,
      userId: 'student-1',
      role: 'STUDENT',
    };

    const detail = await service.detail('program-1', viewer);

    expect(detail.milestones[0]?.viewerSubmissionStatus).toBe('APPROVED');
  });

  it('필수 서류 한 건이 미제출이면 학생 진행은 미제출이다', async () => {
    const { service, findUnique, findFirst } = createService();
    findUnique.mockResolvedValue(programWithRequiredDocuments());
    findFirst.mockResolvedValue({
      id: 'application-1',
      status: ApplicationStatus.APPROVED,
      milestoneDocumentSubmissions: [
        {
          status: SubmissionStatus.APPROVED,
          milestoneDocument: {
            id: 'doc-1',
            milestoneId: 'today',
            kind: MilestoneDocumentKind.DOCUMENT,
          },
        },
      ],
    });
    const viewer: ProgramViewer = {
      githubId: 1n,
      userId: 'student-1',
      role: 'STUDENT',
    };

    const detail = await service.detail('program-1', viewer);

    expect(detail.milestones[0]?.viewerSubmissionStatus).toBe('NOT_SUBMITTED');
  });

  it('교직원 요약도 서류 축을 센다', async () => {
    const { service, findUnique, findMany } = createService();
    findUnique.mockResolvedValue(programWithRequiredDocuments());
    findMany.mockResolvedValue([
      {
        milestoneDocumentSubmissions: [
          {
            status: SubmissionStatus.APPROVED,
            milestoneDocument: {
              id: 'doc-1',
              milestoneId: 'today',
              kind: MilestoneDocumentKind.DOCUMENT,
            },
          },
          {
            status: SubmissionStatus.APPROVED,
            milestoneDocument: {
              id: 'doc-2',
              milestoneId: 'today',
              kind: MilestoneDocumentKind.DOCUMENT,
            },
          },
        ],
      },
      { milestoneDocumentSubmissions: [] },
    ]);
    const viewer: ProgramViewer = {
      githubId: 2n,
      userId: 'staff-1',
      role: 'STAFF',
    };

    const detail = await service.detail('program-1', viewer);

    expect(detail.milestones[0]?.applicationSubmissionSummary).toEqual({
      notSubmitted: 1,
      submitted: 0,
      approved: 1,
      changesRequested: 0,
      rejected: 0,
      total: 2,
    });
  });

  it('제출 항목이 없는 신규 마일스톤은 승인 상태로 위장하지 않는다', async () => {
    const { service, findUnique, findFirst } = createService();
    findUnique.mockResolvedValue({
      ...publicProgram,
      milestones: [
        {
          ...publicProgram.milestones[0],
          submissionType: null,
          documents: [],
          _count: { documents: 0 },
        },
      ],
    });
    findFirst.mockResolvedValue({
      id: 'application-1',
      status: ApplicationStatus.APPROVED,
      milestoneDocumentSubmissions: [],
    });

    const detail = await service.detail('program-1', {
      githubId: 1n,
      userId: 'student-1',
      role: 'STUDENT',
    });

    expect(detail.milestones[0]).toMatchObject({
      submissionType: null,
      submissionItemCount: 0,
      viewerSubmissionStatus: null,
      applicationSubmissionSummary: null,
    });
  });
});

function programWithRequiredDocuments() {
  return {
    ...publicProgram,
    milestones: publicProgram.milestones.map((milestone, index) =>
      index === 0
        ? { ...milestone, documents: [{ id: 'doc-1' }, { id: 'doc-2' }] }
        : milestone,
    ),
  };
}

describe('programDeadline', () => {
  it('Asia/Seoul 달력 날짜를 기준으로 D-day를 계산한다', () => {
    expect(
      programDeadline(
        new Date('2026-07-22T00:01:00+09:00'),
        new Date('2026-07-21T23:59:00+09:00'),
      ),
    ).toEqual({ dDay: 1, label: 'D-1' });
  });

  it('마감 시각과 정확히 같을 때는 아직 마감 후가 아니다', () => {
    const dueAt = new Date('2026-07-21T14:59:59.000Z');

    expect(hasProgramDeadlinePassed(dueAt, dueAt)).toBe(false);
    expect(
      hasProgramDeadlinePassed(dueAt, new Date('2026-07-21T14:59:59.001Z')),
    ).toBe(true);
  });
});

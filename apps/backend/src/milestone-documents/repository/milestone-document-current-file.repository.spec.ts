import {
  AccountStatus,
  MilestoneDocumentKind,
  SubmissionFileLifecycle,
} from '@prisma/client';
import { MilestoneDocumentCurrentFileRepository } from './milestone-document-current-file.repository';

const NOW = new Date('2026-09-20T00:00:00.000Z');

describe('MilestoneDocumentCurrentFileRepository', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('목록·이력과 같은 자격(활성 학생·DOCUMENT·이 마일스톤·그 신청의 팀 구성원)으로 현재 리비전의 살아 있는 첨부만 투영한다', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      revision: 2,
      files: [
        {
          storageKey: 'objects/current',
          originalFileName: 'current.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 23,
          submissionHistory: { revision: 2 },
        },
      ],
    });
    const repository = new MilestoneDocumentCurrentFileRepository({
      milestoneDocumentSubmission: { findFirst },
    });

    const result = await repository.findForParticipant(
      34_290_000n,
      'milestone-current',
      'document-current',
    );

    const activeStudent = {
      githubId: 34_290_000n,
      accountStatus: AccountStatus.ACTIVE,
      hasStaffAccess: false,
      hasAdminAccess: false,
    };
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        milestoneDocumentId: 'document-current',
        milestoneDocument: {
          is: {
            milestoneId: 'milestone-current',
            kind: MilestoneDocumentKind.DOCUMENT,
          },
        },
        application: {
          is: {
            program: {
              is: { milestones: { some: { id: 'milestone-current' } } },
            },
            team: {
              is: { members: { some: { user: { is: activeStudent } } } },
            },
          },
        },
      },
      select: {
        revision: true,
        files: {
          where: {
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            expiresAt: { gt: NOW },
          },
          orderBy: [
            {
              submissionHistory: {
                revision: { sort: 'desc', nulls: 'last' },
              },
            },
            { createdAt: 'desc' },
          ],
          take: 1,
          select: {
            storageKey: true,
            originalFileName: true,
            mimeType: true,
            sizeBytes: true,
            submissionHistory: { select: { revision: true } },
          },
        },
      },
    });
    expect(result).toEqual({
      storageKey: 'objects/current',
      originalFileName: 'current.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 23,
    });
  });

  it('신청을 고르는 문은 program·team 둘뿐이다 — 승인 상태도 applicant도 묻지 않는다', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const repository = new MilestoneDocumentCurrentFileRepository({
      milestoneDocumentSubmission: { findFirst },
    });

    await repository.findForParticipant(
      34_290_004n,
      'milestone-current',
      'document-current',
    );

    const [{ where }] = findFirst.mock.calls[0] as [
      { where: { application: { is: Record<string, unknown> } } },
    ];
    expect(Object.keys(where.application.is).sort()).toEqual([
      'program',
      'team',
    ]);
  });

  it('팀을 고르는 문은 현재 팀원 행 하나뿐이다 — 팀장 갈래도 OR 분기도 없다', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const repository = new MilestoneDocumentCurrentFileRepository({
      milestoneDocumentSubmission: { findFirst },
    });

    await repository.findForParticipant(
      34_290_005n,
      'milestone-current',
      'document-current',
    );

    const [{ where }] = findFirst.mock.calls[0] as [
      { where: { application: { is: { team: { is: unknown } } } } },
    ];
    const team = where.application.is.team.is as Record<string, unknown>;
    expect(Object.keys(team)).toEqual(['members']);
    expect(
      JSON.stringify(team, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ).not.toContain('leader');
  });

  it('파일이 현재 revision과 다른 제출 이력에 연결됐으면 이전 파일을 돌려주지 않는다', async () => {
    const repository = new MilestoneDocumentCurrentFileRepository({
      milestoneDocumentSubmission: {
        findFirst: jest.fn().mockResolvedValue({
          revision: 2,
          files: [
            {
              storageKey: 'objects/older-uploaded-later',
              originalFileName: 'revision-1.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 17,
              submissionHistory: { revision: 1 },
            },
          ],
        }),
      },
    });

    await expect(
      repository.findForParticipant(
        34_290_003n,
        'milestone-current',
        'document-current',
      ),
    ).resolves.toBeNull();
  });

  it('인가·소속·현재 제출·FILE·ATTACHED·만료 조건 중 하나라도 맞지 않으면 null만 돌려준다', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const repository = new MilestoneDocumentCurrentFileRepository({
      milestoneDocumentSubmission: { findFirst },
    });

    await expect(
      repository.findForParticipant(
        34_290_001n,
        'milestone-hidden',
        'document-hidden',
      ),
    ).resolves.toBeNull();
  });

  it('제출 행은 있지만 살아 있는 첨부가 없으면 null만 돌려준다', async () => {
    const repository = new MilestoneDocumentCurrentFileRepository({
      milestoneDocumentSubmission: {
        findFirst: jest.fn().mockResolvedValue({ files: [] }),
      },
    });

    await expect(
      repository.findForParticipant(
        34_290_002n,
        'milestone-stale',
        'document-stale',
      ),
    ).resolves.toBeNull();
  });
});

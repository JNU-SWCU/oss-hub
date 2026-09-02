import {
  AccountStatus,
  ApplicationStatus,
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

  it('승인된 신청의 applicant 또는 현재 팀장·팀원에게 현재 리비전의 살아 있는 첨부만 투영한다', async () => {
    // Given
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

    // When
    const result = await repository.findForApprovedParticipant(
      34_290_000n,
      'milestone-current',
      'document-current',
    );

    // Then
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
          },
        },
        application: {
          is: {
            status: ApplicationStatus.APPROVED,
            program: {
              is: { milestones: { some: { id: 'milestone-current' } } },
            },
            OR: [
              { applicant: { is: activeStudent } },
              { team: { is: { leader: { is: activeStudent } } } },
              {
                team: {
                  is: {
                    members: { some: { user: { is: activeStudent } } },
                  },
                },
              },
            ],
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
      repository.findForApprovedParticipant(
        34_290_003n,
        'milestone-current',
        'document-current',
      ),
    ).resolves.toBeNull();
  });

  it('인가·소속·현재 제출·FILE·ATTACHED·만료 조건 중 하나라도 맞지 않으면 null만 돌려준다', async () => {
    // Given
    const findFirst = jest.fn().mockResolvedValue(null);
    const repository = new MilestoneDocumentCurrentFileRepository({
      milestoneDocumentSubmission: { findFirst },
    });

    // When / Then
    await expect(
      repository.findForApprovedParticipant(
        34_290_001n,
        'milestone-hidden',
        'document-hidden',
      ),
    ).resolves.toBeNull();
  });

  it('제출 행은 있지만 살아 있는 첨부가 없으면 null만 돌려준다', async () => {
    // Given
    const repository = new MilestoneDocumentCurrentFileRepository({
      milestoneDocumentSubmission: {
        findFirst: jest.fn().mockResolvedValue({ files: [] }),
      },
    });

    // When / Then
    await expect(
      repository.findForApprovedParticipant(
        34_290_002n,
        'milestone-stale',
        'document-stale',
      ),
    ).resolves.toBeNull();
  });
});

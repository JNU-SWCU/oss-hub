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

  /**
   * 「보기」와 「받기」가 같은 자격을 쓴다(#1204). 이 where는 목록·이력이 학생의 신청을 찾는
   * 문을 그대로 옮긴 것이라 — 활성 학생 · `kind: DOCUMENT` · 이 마일스톤 소속 · 그 프로그램
   * 신청의 팀 구성원 — 여기서 조건이 하나라도 갈라지면 목록이 보여 준 것과 받을 수 있는 것이
   * 어긋난다.
   */
  it('목록·이력과 같은 자격(활성 학생·DOCUMENT·이 마일스톤·그 신청의 팀 구성원)으로 현재 리비전의 살아 있는 첨부만 투영한다', async () => {
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
    const result = await repository.findForParticipant(
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
            kind: MilestoneDocumentKind.DOCUMENT,
          },
        },
        application: {
          is: {
            program: {
              is: { milestones: { some: { id: 'milestone-current' } } },
            },
            team: {
              is: {
                OR: [
                  { leader: { is: activeStudent } },
                  { members: { some: { user: { is: activeStudent } } } },
                ],
              },
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

  /**
   * 되돌려진 학생이 목록에서 본 파일을 누르면 MSD_020 404가 나던 자리다(#1204).
   *
   * 신청을 고르는 문은 **두 개뿐**이어야 한다 — 이 마일스톤을 가진 프로그램인가(`program`),
   * 그 신청의 팀 구성원인가(`team`). 여기에 `status`가 돌아오면 목록·이력이 묻지 않는 승인을
   * 받기만 다시 묻게 되고, `applicant`(또는 그 시절의 `OR`)가 돌아오면 목록·이력이 이미 막은
   * 사람에게 받기만 열린다. 어느 쪽이든 「보기」와 「받기」가 갈라진다.
   *
   * where를 문자열로 훑지 않고 **키 집합**으로 본다 — `accountStatus`가 `status`를 품고
   * `application`이 `applicant`를 품지 않는 식의 우연에 판정을 맡기지 않기 위해서다.
   */
  it('신청을 고르는 문은 program·team 둘뿐이다 — 승인 상태도 applicant도 묻지 않는다', async () => {
    // Given
    const findFirst = jest.fn().mockResolvedValue(null);
    const repository = new MilestoneDocumentCurrentFileRepository({
      milestoneDocumentSubmission: { findFirst },
    });

    // When
    await repository.findForParticipant(
      34_290_004n,
      'milestone-current',
      'document-current',
    );

    // Then
    const [{ where }] = findFirst.mock.calls[0] as [
      { where: { application: { is: Record<string, unknown> } } },
    ];
    expect(Object.keys(where.application.is).sort()).toEqual([
      'program',
      'team',
    ]);
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
    // Given
    const findFirst = jest.fn().mockResolvedValue(null);
    const repository = new MilestoneDocumentCurrentFileRepository({
      milestoneDocumentSubmission: { findFirst },
    });

    // When / Then
    await expect(
      repository.findForParticipant(
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
      repository.findForParticipant(
        34_290_002n,
        'milestone-stale',
        'document-stale',
      ),
    ).resolves.toBeNull();
  });
});

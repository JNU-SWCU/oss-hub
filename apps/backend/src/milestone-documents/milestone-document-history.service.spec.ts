import { MilestoneDocumentSubmissionHistoryEvent } from '@prisma/client';
import {
  InvalidMilestoneDocumentHistoryCursorError,
  MilestoneDocumentsRepository,
} from './milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';

describe('MilestoneDocumentsService historyForStaff', () => {
  it('checks the document and application program before returning a bounded page', async () => {
    const repository = {
      findDocumentContext: jest.fn().mockResolvedValue({
        id: 'document-1',
        milestoneId: 'milestone-1',
        programId: 'program-1',
      }),
      findApplicationProgramId: jest.fn().mockResolvedValue('program-1'),
      findSubmissionHistoryPage: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'history-1',
            event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
            revision: 1,
            actorNickname: 'synthetic-student',
            comment: null,
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
            fileName: null,
            content: { type: 'TEXT', text: '완료했습니다.' },
          },
        ],
        nextCursor: null,
        isComplete: true,
      }),
    } as unknown as MilestoneDocumentsRepository;
    const service = new MilestoneDocumentsService(repository);

    const result = await service.historyForStaff(
      'milestone-1',
      'document-1',
      'application-1',
      { cursor: null, limit: 20 },
    );

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
          createdAt: '2026-09-01T00:00:00.000Z',
          content: { type: 'TEXT', text: '완료했습니다.' },
        }),
      ],
      nextCursor: null,
      isComplete: true,
    });
  });

  it('maps an out-of-scope cursor to the invalid-request contract', async () => {
    const repository = {
      findDocumentContext: jest.fn().mockResolvedValue({
        id: 'document-1',
        milestoneId: 'milestone-1',
        programId: 'program-1',
      }),
      findApplicationProgramId: jest.fn().mockResolvedValue('program-1'),
      findSubmissionHistoryPage: jest
        .fn()
        .mockRejectedValue(new InvalidMilestoneDocumentHistoryCursorError()),
    } as unknown as MilestoneDocumentsRepository;

    await expect(
      new MilestoneDocumentsService(repository).historyForStaff(
        'milestone-1',
        'document-1',
        'application-1',
        { cursor: 'foreign-history', limit: 20 },
      ),
    ).rejects.toMatchObject({ errorCode: { code: 'MSD_019' } });
  });
});

describe('MilestoneDocumentsService history download links', () => {
  const documentContext = {
    id: 'document-1',
    milestoneId: 'milestone-1',
    programId: 'program-1',
  };

  function historyItem(overrides: Record<string, unknown>) {
    return {
      id: 'history-1',
      event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
      revision: 1,
      actorNickname: 'synthetic-student',
      comment: null,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      fileName: null,
      downloadableFileId: null,
      content: null,
      ...overrides,
    };
  }

  function repositoryWith(item: Record<string, unknown>) {
    return {
      findDocumentContext: jest.fn().mockResolvedValue(documentContext),
      findApplicationProgramId: jest.fn().mockResolvedValue('program-1'),
      findActiveUser: jest.fn().mockResolvedValue({
        id: 'user-1',
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: 'application-1',
        approved: true,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
      findSubmissionHistoryPage: jest.fn().mockResolvedValue({
        items: [item],
        nextCursor: null,
        isComplete: true,
      }),
    } as unknown as MilestoneDocumentsRepository;
  }

  it('학생 이력의 살아 있는 첨부에는 본인 다운로드 주소를 준다', async () => {
    const service = new MilestoneDocumentsService(
      repositoryWith(
        historyItem({
          fileName: '1차_계획서.pdf',
          downloadableFileId: 'file-1',
        }),
      ),
    );

    const result = await service.historyForParticipant(
      1n,
      'milestone-1',
      'document-1',
      { cursor: null, limit: 20 },
    );

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        fileName: '1차_계획서.pdf',
        downloadUrl: '/api/v1/submission-files/file-1',
      }),
    );
  });

  it('교직원 이력도 같은 주소를 받는다 — 재제출로 떨어져 나간 첨부에 닿을 길이다', async () => {
    const service = new MilestoneDocumentsService(
      repositoryWith(
        historyItem({
          fileName: '1차_계획서.pdf',
          downloadableFileId: 'file-1',
        }),
      ),
    );

    const result = await service.historyForStaff(
      'milestone-1',
      'document-1',
      'application-1',
      { cursor: null, limit: 20 },
    );

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        downloadUrl: '/api/v1/submission-files/file-1',
      }),
    );
  });

  it('보관 기한이 지난 첨부에는 주소를 주지 않는다 — 죽은 버튼을 세우지 않는다', async () => {
    const service = new MilestoneDocumentsService(
      repositoryWith(
        historyItem({
          fileName: '만료된_계획서.pdf',
          downloadableFileId: null,
        }),
      ),
    );

    const result = await service.historyForStaff(
      'milestone-1',
      'document-1',
      'application-1',
      { cursor: null, limit: 20 },
    );

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        fileName: '만료된_계획서.pdf',
        downloadUrl: null,
      }),
    );
  });
});

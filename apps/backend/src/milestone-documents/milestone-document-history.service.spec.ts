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

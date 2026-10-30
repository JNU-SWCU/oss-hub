import { MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../../platform/error-code.error';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from '../domain/program-error-code.enum';
import {
  createProgramEditorServiceHarness,
  milestoneInput,
} from '../../../test/program-editor-service-fixtures';
import { fingerprintProgramMilestoneEdit } from '../domain/program-milestone-edit';

describe('ProgramEditorService milestones', () => {
  it('updates the selected milestone by canonical id through the aggregate edit contract', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    const locked = {
      programId: 'program-1',
      milestoneUpdatedAt: new Date('2026-08-16T00:00:00.000Z'),
      view: {
        milestone: {
          id: 'milestone-canonical-id',
          name: 'Same',
          startAt: new Date('2026-08-16T00:00:00.000Z'),
          dueAt: new Date('2026-08-20T00:00:00.000Z'),
          submissionType: MilestoneSubmissionType.FILE,
          instructions: null,
        },
        operation: {
          startAt: new Date('2026-08-16T00:00:00.000Z'),
          endAt: new Date('2026-08-31T00:00:00.000Z'),
        },
        documents: [
          {
            id: 'document-canonical-id',
            name: 'Report',
            required: true,
            sortOrder: 1,
            templateFileName: null,
          },
        ],
      },
      fingerprintDocuments: [
        {
          id: 'document-canonical-id',
          name: 'Report',
          required: true,
          sortOrder: 1,
          updatedAt: new Date('2026-08-16T00:00:00.000Z'),
          storageKey: null,
        },
      ],
    };
    store.lockMilestoneEdit.mockResolvedValue(locked);
    store.readMilestoneEdit.mockResolvedValue(locked);
    store.countSubmissionHistoriesForDocuments.mockResolvedValue(0);
    store.lockAttachableUploads.mockResolvedValue([]);

    const expectedFingerprint = fingerprintProgramMilestoneEdit({
      operation: locked.view.operation,
      milestone: {
        ...locked.view.milestone,
        updatedAt: locked.milestoneUpdatedAt,
      },
      documents: locked.fingerprintDocuments,
    });

    await service.updateMilestoneEdit(101n, 'milestone-canonical-id', {
      expectedFingerprint,
      name: ' Same ',
      startAt: '2026-08-16T00:00:00.000Z',
      dueAt: '2026-08-20T00:00:00.000Z',
      instructions: ' tag v1.0.0 ',
      documents: [
        {
          id: 'document-canonical-id',
          name: 'Report',
          required: true,
        },
      ],
    });

    expect(store.applyMilestoneEdit.mock.calls[0]?.[0]).toMatchObject({
      actorId: 'staff-1',
      milestoneId: 'milestone-canonical-id',
      name: 'Same',
      startAt: new Date('2026-08-16T00:00:00.000Z'),
      dueAt: new Date('2026-08-20T00:00:00.000Z'),
      submissionType: MilestoneSubmissionType.FILE,
      instructions: 'tag v1.0.0',
    });
  });

  it.each([
    [
      'before the Program',
      '2026-08-15T23:59:59.999Z',
      '2026-08-20T00:00:00.000Z',
    ],
    ['equal to dueAt', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'],
    ['after dueAt', '2026-08-21T00:00:00.000Z', '2026-08-20T00:00:00.000Z'],
  ])(
    'rejects a milestone start %s without writing',
    async (_case, startAt, dueAt) => {
      const { service, store } = createProgramEditorServiceHarness();
      store.findProgramScheduleForMilestoneCreate.mockResolvedValue({
        id: 'program-1',
        startAt: new Date('2026-08-16T00:00:00.000Z'),
        endAt: new Date('2026-08-31T00:00:00.000Z'),
      });

      await expect(
        service.createMilestone(101n, 'program-1', {
          ...milestoneInput,
          startAt,
          dueAt,
        }),
      ).rejects.toMatchObject<Partial<DomainException>>({
        errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
      });
      expect(store.createMilestone.mock.calls).toHaveLength(0);
    },
  );

  it('rejects a milestone dueAt after Program end without writing', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findProgramScheduleForMilestoneCreate.mockResolvedValue({
      id: 'program-1',
      startAt: new Date('2026-08-16T00:00:00.000Z'),
      endAt: new Date('2026-08-31T00:00:00.000Z'),
    });

    await expect(
      service.createMilestone(101n, 'program-1', {
        ...milestoneInput,
        startAt: '2026-08-20T00:00:00.000Z',
        dueAt: '2026-09-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
    });
    expect(store.createMilestone.mock.calls).toHaveLength(0);
  });

  it('allows a milestone dueAt equal to Program end', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findProgramScheduleForMilestoneCreate.mockResolvedValue({
      id: 'program-1',
      startAt: new Date('2026-08-16T00:00:00.000Z'),
      endAt: new Date('2026-08-31T00:00:00.000Z'),
    });

    await service.createMilestone(101n, 'program-1', {
      ...milestoneInput,
      startAt: '2026-08-20T00:00:00.000Z',
      dueAt: '2026-08-31T00:00:00.000Z',
    });

    expect(store.createMilestone.mock.calls).toHaveLength(1);
  });

  it('서류 항목에 제출물이 있으면 마일스톤을 지우지 않고 MILESTONE_HAS_SUBMISSIONS로 거부한다', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findMilestoneForDelete.mockResolvedValue({
      id: 'cuid-synthetic-milestone',
      programId: 'cuid-synthetic-program',
      documentSubmissionCount: 1,
      programMilestoneCount: 2,
      programRepositoryProvisioningEnabled: false,
    });

    await expect(
      service.deleteMilestone(101n, 'cuid-synthetic-milestone'),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.MILESTONE_HAS_SUBMISSIONS],
    });
    expect(store.deleteMilestone.mock.calls).toHaveLength(0);
  });

  it('서류 항목만 있고 제출물이 없으면 마일스톤을 지운다', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findMilestoneForDelete.mockResolvedValue({
      id: 'cuid-synthetic-milestone',
      programId: 'cuid-synthetic-program',
      documentSubmissionCount: 0,
      programMilestoneCount: 2,
      programRepositoryProvisioningEnabled: false,
    });

    await service.deleteMilestone(101n, 'cuid-synthetic-milestone');

    expect(store.deleteMilestone.mock.calls).toEqual([
      ['cuid-synthetic-milestone'],
    ]);
  });
});

describe('milestone due and document grace consistency', () => {
  it.each(['2026-08-21T00:00:00Z', '2026-08-22T00:00:00Z'])(
    '유예보다 같거나 늦어진 마감을 거절한다: %s',
    async (dueAt) => {
      const { service, store } = createProgramEditorServiceHarness();
      store.findMilestoneForUpdate.mockResolvedValue({
        id: 'milestone-1',
        programId: 'program-1',
        name: '단계',
        startAt: new Date('2026-08-16'),
        dueAt: new Date('2026-08-20'),
        submissionType: MilestoneSubmissionType.FILE,
        instructions: null,
        programStartAt: new Date('2026-08-16'),
        endAt: new Date('2026-08-31'),
      });
      store.findEarliestDocumentGraceDueAt.mockResolvedValue(
        new Date('2026-08-21T00:00:00Z'),
      );
      await expect(
        service.updateMilestone(101n, 'milestone-1', {
          ...milestoneInput,
          dueAt,
        }),
      ).rejects.toMatchObject({
        extensions: {
          fieldErrors: [
            {
              field: 'dueAt',
              code: 'DOCUMENT_GRACE_DUE_AT_CONFLICT',
              message:
                '마감은 서류 유예 기한보다 앞이어야 합니다. 서류 유예 기한을 먼저 변경하거나 해제해 주세요.',
            },
          ],
        },
      });
      expect(store.updateMilestone.mock.calls).toHaveLength(0);
    },
  );
});

it('문서 묶음 편집도 기존 유예 이후로 마감을 옮길 수 없다', async () => {
  const { service, store } = createProgramEditorServiceHarness();
  const locked = {
    programId: 'program-1',
    milestoneUpdatedAt: new Date('2026-08-16'),
    view: {
      milestone: {
        id: 'milestone-1',
        name: '단계',
        startAt: new Date('2026-08-16'),
        dueAt: new Date('2026-08-20'),
        submissionType: MilestoneSubmissionType.FILE,
        instructions: null,
      },
      operation: {
        startAt: new Date('2026-08-16'),
        endAt: new Date('2026-08-31'),
      },
      documents: [
        {
          id: 'document-1',
          name: '서류',
          required: true,
          sortOrder: 1,
          templateFileName: null,
        },
      ],
    },
    fingerprintDocuments: [
      {
        id: 'document-1',
        name: '서류',
        required: true,
        sortOrder: 1,
        updatedAt: new Date('2026-08-16'),
        storageKey: null,
      },
    ],
  };
  store.lockMilestoneEdit.mockResolvedValue(locked);
  store.findEarliestDocumentGraceDueAt.mockResolvedValue(
    new Date('2026-08-21'),
  );
  const current = await service.getMilestoneEdit(101n, 'milestone-1');
  await expect(
    service.updateMilestoneEdit(101n, 'milestone-1', {
      ...milestoneInput,
      startAt: '2026-08-16T00:00:00Z',
      instructions: null,
      dueAt: '2026-08-21T00:00:00Z',
      expectedFingerprint: current.fingerprint,
      documents: [{ id: 'document-1', name: '서류', required: true }],
    }),
  ).rejects.toMatchObject({
    extensions: {
      fieldErrors: [
        {
          field: 'dueAt',
          code: 'DOCUMENT_GRACE_DUE_AT_CONFLICT',
          message:
            '마감은 서류 유예 기한보다 앞이어야 합니다. 서류 유예 기한을 먼저 변경하거나 해제해 주세요.',
        },
      ],
    },
  });
  expect(store.applyMilestoneEdit.mock.calls).toHaveLength(0);
});

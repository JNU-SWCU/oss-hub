import { MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from '../program-error-code.enum';
import {
  createProgramEditorServiceHarness,
  milestoneInput,
} from '../../../test/program-editor-service-fixtures';

describe('ProgramEditorService milestones', () => {
  it('updates the selected milestone by canonical id when names are duplicated', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findMilestoneForUpdate.mockResolvedValue({
      id: 'milestone-canonical-id',
      programId: 'program-1',
      programStartAt: new Date('2026-08-16T00:00:00.000Z'),
      endAt: new Date('2026-08-31T00:00:00.000Z'),
      name: 'Same',
      startAt: new Date('2026-08-16T00:00:00.000Z'),
      dueAt: new Date('2026-08-20T00:00:00.000Z'),
      submissionType: MilestoneSubmissionType.FILE,
      instructions: null,
    });
    store.updateMilestone.mockResolvedValue({
      id: 'milestone-canonical-id',
      name: 'Final',
      startAt: new Date('2026-08-16T00:00:00.000Z'),
      dueAt: new Date('2026-08-20T00:00:00.000Z'),
      submissionType: MilestoneSubmissionType.TEXT,
      instructions: 'tag v1.0.0',
    });

    await service.updateMilestone(101n, 'milestone-canonical-id', {
      ...milestoneInput,
      name: ' Same ',
    });

    expect(store.updateMilestone.mock.calls[0]?.[0]).toEqual({
      milestoneId: 'milestone-canonical-id',
      name: 'Same',
      startAt: new Date('2026-08-16T00:00:00.000Z'),
      dueAt: new Date('2026-08-20T00:00:00.000Z'),
      submissionType: MilestoneSubmissionType.TEXT,
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

  it.each([
    ['equal to Program end', '2026-08-31T00:00:00.000Z'],
    ['after Program end', '2026-09-01T00:00:00.000Z'],
  ])('rejects a milestone dueAt %s without writing', async (_case, dueAt) => {
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
        dueAt,
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
    });
    expect(store.createMilestone.mock.calls).toHaveLength(0);
  });

  it('rejects milestone deletion when submissions exist', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findMilestoneForDelete.mockResolvedValue({
      id: 'milestone-1',
      programId: 'program-1',
      submissionCount: 1,
      documentSubmissionCount: 0,
      programMilestoneCount: 2,
      programRepositoryProvisioningEnabled: false,
    });

    await expect(
      service.deleteMilestone(101n, 'milestone-1'),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.MILESTONE_HAS_SUBMISSIONS],
    });
    expect(store.deleteMilestone.mock.calls).toHaveLength(0);
  });

  it('서류 항목에 제출물이 있으면 마일스톤을 지우지 않고 MILESTONE_HAS_SUBMISSIONS로 거부한다', async () => {
    // Given: 옛 Submission은 없지만 서류 항목(MilestoneDocument)에 제출이 하나 있다.
    const { service, store } = createProgramEditorServiceHarness();
    store.findMilestoneForDelete.mockResolvedValue({
      id: 'cuid-synthetic-milestone',
      programId: 'cuid-synthetic-program',
      submissionCount: 0,
      documentSubmissionCount: 1,
      programMilestoneCount: 2,
      programRepositoryProvisioningEnabled: false,
    });

    // When / Then: 두 제출 경로는 「제출물이 있다」는 뜻이 같아 같은 코드로 거부한다.
    await expect(
      service.deleteMilestone(101n, 'cuid-synthetic-milestone'),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.MILESTONE_HAS_SUBMISSIONS],
    });
    expect(store.deleteMilestone.mock.calls).toHaveLength(0);
  });

  it('서류 항목만 있고 제출물이 없으면 마일스톤을 지운다', async () => {
    // Given: 교직원이 서류 항목만 만들어 둔 마일스톤 — 아직 아무 팀도 내지 않았다.
    const { service, store } = createProgramEditorServiceHarness();
    store.findMilestoneForDelete.mockResolvedValue({
      id: 'cuid-synthetic-milestone',
      programId: 'cuid-synthetic-program',
      submissionCount: 0,
      documentSubmissionCount: 0,
      programMilestoneCount: 2,
      programRepositoryProvisioningEnabled: false,
    });

    // When
    await service.deleteMilestone(101n, 'cuid-synthetic-milestone');

    // Then: 서류 항목은 마일스톤 없이는 뜻이 없는 설정이라 함께 사라진다(리포지토리가 처리).
    expect(store.deleteMilestone.mock.calls).toEqual([
      ['cuid-synthetic-milestone'],
    ]);
  });
});

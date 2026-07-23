import { MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from './program-error-code.enum';
import {
  createProgramEditorServiceHarness,
  milestoneInput,
} from '../../test/program-editor-service-fixtures';

describe('ProgramEditorService milestones', () => {
  it('updates the selected milestone by canonical id when names are duplicated', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findMilestoneForUpdate.mockResolvedValue({
      id: 'milestone-canonical-id',
      programId: 'program-1',
      applicationEndAt: new Date('2026-08-15T00:00:00.000Z'),
      name: 'Same',
      dueAt: new Date('2026-08-20T00:00:00.000Z'),
      submissionType: MilestoneSubmissionType.FILE,
      instructions: null,
    });
    store.updateMilestone.mockResolvedValue({
      id: 'milestone-canonical-id',
      name: 'Final',
      dueAt: new Date('2026-08-20T00:00:00.000Z'),
      submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
      instructions: 'tag v1.0.0',
    });

    await service.updateMilestone(101n, 'milestone-canonical-id', {
      ...milestoneInput,
      name: ' Same ',
    });

    expect(store.updateMilestone.mock.calls[0]?.[0]).toEqual({
      milestoneId: 'milestone-canonical-id',
      name: 'Same',
      dueAt: new Date('2026-08-20T00:00:00.000Z'),
      submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
      instructions: 'tag v1.0.0',
    });
  });

  it('rejects milestone deletion when submissions exist', async () => {
    const { service, store } = createProgramEditorServiceHarness();
    store.findMilestoneForDelete.mockResolvedValue({
      id: 'milestone-1',
      programId: 'program-1',
      submissionCount: 1,
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
});

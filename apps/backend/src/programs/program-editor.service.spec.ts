import {
  AccountStatus,
  MilestoneSubmissionType,
  ProgramCategory,
  Role,
} from '@prisma/client';
import { DomainException } from '../common/error-code';
import type { UpdateProgramRequestDto } from './dto/update-program-request.dto';
import type { UpsertMilestoneRequestDto } from './dto/upsert-milestone-request.dto';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from './program-error-code.enum';
import {
  ProgramEditorService,
  type ProgramEditorRepositoryPort,
  type ProgramEditorTransactionStore,
} from './program-editor.service';

const updateInput: UpdateProgramRequestDto = {
  name: '  Updated OSS  ',
  organizer: '  SW Center  ',
  category: ProgramCategory.OSS_CONTEST,
  applicationStartAt: '2026-08-01T00:00:00.000Z',
  applicationEndAt: '2026-08-15T00:00:00.000Z',
  repositoryProvisioningEnabled: true,
  description: '  updated overview  ',
  teamMinSize: 2,
  teamMaxSize: 4,
};

const milestoneInput: UpsertMilestoneRequestDto = {
  name: '  Final  ',
  dueAt: '2026-08-20T00:00:00.000Z',
  submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
  instructions: '  tag v1.0.0  ',
};

const editableProgram = {
  id: 'program-1',
  name: 'OSS',
  organizer: 'Center',
  category: ProgramCategory.BASIC,
  applicationTemplateKey: 'basic',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
  applicationEndAt: new Date('2026-08-10T00:00:00.000Z'),
  repositoryProvisioningEnabled: false,
  description: 'overview',
  milestones: [
    {
      id: 'milestone-1',
      name: 'Existing',
      dueAt: new Date('2026-08-20T00:00:00.000Z'),
      submissionType: MilestoneSubmissionType.FILE,
      instructions: null,
    },
  ],
  teamMinSize: null,
  teamMaxSize: null,
} as const;

describe('ProgramEditorService', () => {
  const store: jest.Mocked<ProgramEditorTransactionStore> = {
    findUserAuthorityByGithubId: jest.fn(),
    findEditableProgramById: jest.fn(),
    findEditableProgramForUpdate: jest.fn(),
    updateProgram: jest.fn(),
    findProgramScheduleForMilestoneCreate: jest.fn(),
    createMilestone: jest.fn(),
    findMilestoneForUpdate: jest.fn(),
    updateMilestone: jest.fn(),
    findMilestoneForDelete: jest.fn(),
    deleteMilestone: jest.fn(),
  };
  const withTransaction = jest.fn();
  const repository: ProgramEditorRepositoryPort = {
    withTransaction: (operation) => {
      withTransaction(operation);
      return operation(store);
    },
  };
  const service = new ProgramEditorService(repository);

  beforeEach(() => {
    jest.clearAllMocks();
    store.findUserAuthorityByGithubId.mockResolvedValue({
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
    });
  });

  it('loads edit data by canonical program id inside one repository transaction', async () => {
    store.findEditableProgramById.mockResolvedValue(editableProgram);

    await expect(service.getProgram(101n, 'program-1')).resolves.toBe(
      editableProgram,
    );

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(store.findEditableProgramById.mock.calls[0]).toEqual(['program-1']);
  });

  it('rejects inactive staff before edit data is exposed', async () => {
    store.findUserAuthorityByGithubId.mockResolvedValue({
      role: Role.STAFF,
      accountStatus: AccountStatus.DEACTIVATED,
    });

    await expect(service.getProgram(101n, 'program-1')).rejects.toMatchObject<
      Partial<DomainException>
    >({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.FORBIDDEN],
    });
    expect(store.findEditableProgramById.mock.calls).toHaveLength(0);
  });

  it('rejects changing to a team template without a complete team range', async () => {
    store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);

    await expect(
      service.updateProgram(101n, 'program-1', {
        ...updateInput,
        teamMinSize: null,
        teamMaxSize: null,
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
    });
    expect(store.updateProgram.mock.calls).toHaveLength(0);
  });

  it('keeps create and update period invariants aligned', async () => {
    store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);

    await expect(
      service.updateProgram(101n, 'program-1', {
        ...updateInput,
        applicationEndAt: '2026-07-31T00:00:00.000Z',
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
    });
    expect(store.updateProgram.mock.calls).toHaveLength(0);
  });

  it('rejects category changes after applications exist before writing updates', async () => {
    store.findEditableProgramForUpdate.mockResolvedValue({
      ...editableProgram,
      applicationCount: 1,
      category: ProgramCategory.BASIC,
    });

    await expect(
      service.updateProgram(101n, 'program-1', updateInput),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.CATEGORY_LOCKED_BY_APPLICATIONS],
    });
    expect(store.updateProgram.mock.calls).toHaveLength(0);
  });

  it('rejects an application end date that reaches an existing milestone', async () => {
    store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);

    await expect(
      service.updateProgram(101n, 'program-1', {
        ...updateInput,
        applicationEndAt: '2026-08-20T00:00:00.000Z',
      }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.MILESTONE_BEFORE_APPLICATION_END],
    });
  });

  it('updates the selected milestone by canonical id when names are duplicated', async () => {
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

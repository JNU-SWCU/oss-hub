import {
  AccountStatus,
  MilestoneSubmissionType,
  ProgramCategory,
  Role,
} from '@prisma/client';
import type { UpdateProgramRequestDto } from '../src/programs/dto/update-program-request.dto';
import type { UpsertMilestoneRequestDto } from '../src/programs/dto/upsert-milestone-request.dto';
import {
  ProgramEditorService,
  type ProgramEditorRepositoryPort,
  type ProgramEditorTransactionStore,
} from '../src/programs/program-editor.service';

export const updateInput: UpdateProgramRequestDto = {
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

export const milestoneInput: UpsertMilestoneRequestDto = {
  name: '  Final  ',
  dueAt: '2026-08-20T00:00:00.000Z',
  submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
  instructions: '  tag v1.0.0  ',
};

export const editableProgram = {
  id: 'program-1',
  name: 'OSS',
  organizer: 'Center',
  category: ProgramCategory.BASIC,
  applicationTemplateKey: 'basic',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  teamCount: 0,
  categoryLocked: {
    locked: false,
    byApplications: false,
    byTeams: false,
    applicationCount: 0,
    teamCount: 0,
  },
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

export function createProgramEditorServiceHarness(): {
  readonly service: ProgramEditorService;
  readonly store: jest.Mocked<ProgramEditorTransactionStore>;
  readonly withTransaction: jest.Mock;
} {
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
  store.findUserAuthorityByGithubId.mockResolvedValue({
    role: Role.STAFF,
    accountStatus: AccountStatus.ACTIVE,
    roleRequests: [],
  });
  return { service: new ProgramEditorService(repository), store, withTransaction };
}

export function teamInputFor(
  category: ProgramCategory,
): Pick<UpdateProgramRequestDto, 'teamMinSize' | 'teamMaxSize'> {
  switch (category) {
    case ProgramCategory.OSS_CONTEST:
    case ProgramCategory.CAPSTONE:
    case ProgramCategory.SW_CONVERGENCE:
    case ProgramCategory.GLOBAL_MAKERTHON:
      return { teamMinSize: 2, teamMaxSize: 4 };
    case ProgramCategory.BASIC:
    case ProgramCategory.SW_VALUE_SPREAD:
    case ProgramCategory.CORPORATE_INTERNSHIP:
      return { teamMinSize: null, teamMaxSize: null };
  }
}

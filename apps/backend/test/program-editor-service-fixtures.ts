import {
  AccountStatus,
  MilestoneSubmissionType,
  ProgramTrackType,
} from '@prisma/client';
import {
  ProgramEditorService,
  type UpdateProgramCommand,
  type UpsertMilestoneCommand,
} from '../src/programs/program-editor.service';
import type {
  ProgramEditorRepository,
  ProgramEditorTransactionStore,
} from '../src/programs/program-editor.repository';
import { ProgramCoverUrlService } from '../src/programs/program-cover-url.service';
import { ProgramRulesService } from '../src/programs/program-rules.service';
import { ProgramUploadRulesService } from '../src/programs/program-upload-rules.service';
import { SubmissionFileRulesService } from '../src/programs/submission-file-rules.service';

export const updateInput: UpdateProgramCommand = {
  name: '  Updated OSS  ',
  organizer: '  SW Center  ',
  trackType: ProgramTrackType.EXTRACURRICULAR,
  applicationStartAt: '2026-08-01T00:00:00.000Z',
  applicationEndAt: '2026-08-15T00:00:00.000Z',
  startAt: '2026-08-16T00:00:00.000Z',
  endAt: '2026-08-31T00:00:00.000Z',
  repositoryProvisioningEnabled: true,
  notifyOnDeadline: true,
  description: '  updated overview  ',
  teamMinSize: 2,
  teamMaxSize: 4,
};

export const milestoneInput: UpsertMilestoneCommand = {
  name: '  Final  ',
  startAt: '2026-08-16T00:00:00.000Z',
  dueAt: '2026-08-20T00:00:00.000Z',
  instructions: '  tag v1.0.0  ',
};

export const editableProgram = {
  coverId: null,
  coverExternalImageUrl: null,
  id: 'program-1',
  name: 'OSS',
  organizer: 'Center',
  trackType: ProgramTrackType.CURRICULAR,
  applicationTemplateKey: 'basic',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  teamCount: 0,
  applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
  applicationEndAt: new Date('2026-08-10T00:00:00.000Z'),
  startAt: new Date('2026-08-16T00:00:00.000Z'),
  endAt: '2026-08-31T00:00:00.000Z',
  repositoryProvisioningEnabled: false,
  notifyOnDeadline: false,
  description: 'overview',
  milestones: [
    {
      id: 'milestone-1',
      name: 'Existing',
      startAt: new Date('2026-08-16T00:00:00.000Z'),
      dueAt: new Date('2026-08-20T00:00:00.000Z'),
      submissionType: MilestoneSubmissionType.FILE,
      instructions: null,
    },
  ],
  teamMinSize: 1,
  teamMaxSize: 1,
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
    updateProgram: jest.fn().mockResolvedValue(editableProgram),
    findProgramScheduleForMilestoneCreate: jest.fn(),
    createMilestone: jest.fn(),
    findMilestoneForUpdate: jest.fn(),
    updateMilestone: jest.fn(),
    findLatestDocumentGraceDueAt: jest.fn().mockResolvedValue(null),
    findEarliestDocumentGraceDueAt: jest.fn().mockResolvedValue(null),

    findMilestoneForDelete: jest.fn(),
    deleteMilestone: jest.fn(),
    lockMilestoneEdit: jest.fn(),
    readMilestoneEdit: jest.fn(),
    countSubmissionHistoriesForDocuments: jest.fn(),
    lockAttachableUploads: jest.fn(),
    applyMilestoneEdit: jest.fn(),
  };
  const withTransaction = jest.fn();
  const repository: Pick<ProgramEditorRepository, 'withTransaction'> = {
    withTransaction: (operation) => {
      withTransaction(operation);
      return operation(store);
    },
  };
  store.findUserAuthorityByGithubId.mockResolvedValue({
    id: 'staff-1',
    hasStaffAccess: true,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
    staffAccessRequests: [],
  });
  return {
    service: new ProgramEditorService(
      repository,
      new ProgramCoverUrlService(),
      new ProgramRulesService(),
      new ProgramUploadRulesService(new SubmissionFileRulesService()),
      new SubmissionFileRulesService(),
    ),
    store,
    withTransaction,
  };
}

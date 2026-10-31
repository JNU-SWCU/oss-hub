import { SubmissionInputService } from './submission-input.service';
import type { SubmissionsStore } from './submissions.repository';
import { SubmissionsService } from './submissions.service';
import { ProgramRulesService } from './program-rules.service';
import { SubmissionFileRulesService } from './submission-file-rules.service';

type SubmissionStoreMocks = {
  readonly [Method in keyof SubmissionsStore]: jest.Mock<
    ReturnType<SubmissionsStore[Method]>,
    Parameters<SubmissionsStore[Method]>
  >;
};

function mockStoreMethod<Method extends keyof SubmissionsStore>() {
  return jest.fn<
    ReturnType<SubmissionsStore[Method]>,
    Parameters<SubmissionsStore[Method]>
  >();
}

export function createSubmissionsServiceHarness(): {
  readonly service: SubmissionsService;
  readonly store: SubmissionStoreMocks;
  readonly didRollBack: () => boolean;
} {
  const store = {
    findActiveStudentByGithubId:
      mockStoreMethod<'findActiveStudentByGithubId'>(),
    findMilestoneByProgram: mockStoreMethod<'findMilestoneByProgram'>(),
    findMilestoneById: mockStoreMethod<'findMilestoneById'>(),
    findParticipantApplication: mockStoreMethod<'findParticipantApplication'>(),
    findApplicationForParticipant:
      mockStoreMethod<'findApplicationForParticipant'>(),
    lockProgramEndAt: mockStoreMethod<'lockProgramEndAt'>(),
    createSubmission: mockStoreMethod<'createSubmission'>(),
    findChecklistApplication: mockStoreMethod<'findChecklistApplication'>(),
    listChecklistMilestones: mockStoreMethod<'listChecklistMilestones'>(),
    findSubmissionForParticipant:
      mockStoreMethod<'findSubmissionForParticipant'>(),
    submissionExists: mockStoreMethod<'submissionExists'>(),
    createSubmissionRevision: mockStoreMethod<'createSubmissionRevision'>(),
  } satisfies jest.Mocked<SubmissionsStore>;
  let rolledBack = false;
  const repository = {
    ...store,
    async withTransaction<T>(
      operation: (transactionStore: SubmissionsStore) => Promise<T>,
    ): Promise<T> {
      try {
        return await operation(store);
      } catch (error: unknown) {
        rolledBack = true;
        throw error;
      }
    },
  } satisfies ConstructorParameters<typeof SubmissionsService>[0];
  return {
    service: new SubmissionsService(
      repository,
      new ProgramRulesService(),
      new SubmissionFileRulesService(),
      new SubmissionInputService(),
    ),
    store,
    didRollBack: () => rolledBack,
  };
}

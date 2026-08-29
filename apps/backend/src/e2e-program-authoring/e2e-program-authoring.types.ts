import type { DeadlineDigestPreview } from '../notifications/deadline-digest.service';

export const E2E_FAILURE_KINDS = [
  'upload',
  'prisma',
  'smtp',
  'github',
  'cleanup',
] as const;

export type E2eFailureKind = (typeof E2E_FAILURE_KINDS)[number];

export type E2eProgramAuthoringGraph = {
  readonly programId: string;
  /** The required-file milestone used for submission and archive checks. */
  readonly milestoneId: string;
  /** The required-file document used for submission and archive checks. */
  readonly documentId: string;
};

export type E2eProgramAuthoringState = {
  readonly programs: number;
  readonly milestones: number;
  /** Every submission item persisted across all milestones in the program. */
  readonly documents: number;
  readonly applications: number;
  readonly teams: number;
  readonly repositoryJobs: number;
  readonly repositories: number;
  readonly notifications: number;
  readonly dryRunEnvelopes: number;
  readonly attachedFiles: number;
  readonly orphanRows: number;
  readonly orphanObjects: number;
  readonly mailContentHashes: readonly string[];
  readonly storageContentHashes: readonly string[];
};

export interface E2eProgramAuthoringPort {
  reset(): Promise<void>;
  fixture(): Promise<E2eProgramAuthoringGraph>;
  adopt(
    programId: string,
    authorGithubId: bigint,
  ): Promise<E2eProgramAuthoringGraph>;
  stateFor(programId: string): Promise<E2eProgramAuthoringState>;
  preview(): Promise<DeadlineDigestPreview>;
  createApplication(mode: 'NEW' | 'OWN'): Promise<void>;
  approveAndRun(): Promise<void>;
  configureFailure(kind: E2eFailureKind, attempts: number): void;
  exercise(kind: E2eFailureKind): Promise<void>;
  stalePreview(): Promise<void>;
  crossTeamCurrentFile(): Promise<void>;
}

export const E2E_PROGRAM_AUTHORING_PORT = Symbol('E2E_PROGRAM_AUTHORING_PORT');

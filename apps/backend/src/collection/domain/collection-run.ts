import { GithubObservation } from './github-observation';

export const COLLECTION_TRIGGERS = {
  SELF: 'SELF',
  BATCH: 'BATCH',
} as const;

export type CollectionTrigger =
  (typeof COLLECTION_TRIGGERS)[keyof typeof COLLECTION_TRIGGERS];

export const COLLECTION_RUN_STATUSES = {
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type CollectionRunStatus =
  (typeof COLLECTION_RUN_STATUSES)[keyof typeof COLLECTION_RUN_STATUSES];

export const OBSERVATION_SOURCE_TYPES = {
  PROFILE: 'PROFILE',
  REPO: 'REPO',
  EVENT: 'EVENT',
} as const;

export type ObservationSourceType =
  (typeof OBSERVATION_SOURCE_TYPES)[keyof typeof OBSERVATION_SOURCE_TYPES];

export interface CollectionUser {
  githubId: bigint;
  login: string;
}

export interface CollectionRun {
  id: string;
  targetGithubId: bigint;
  targetLogin: string;
  trigger: CollectionTrigger;
  status: CollectionRunStatus;
  profileCount: number;
  repoCount: number;
  eventCount: number;
  retryNotBeforeAt: Date | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export const COLLECTION_RUN_START_KINDS = {
  STARTED: 'STARTED',
  REJECTED: 'REJECTED',
} as const;

export const COLLECTION_RUN_COOLDOWN_MS = 60_000 as const;
export const COLLECTION_RUN_STALE_AFTER_MS = 30 * 60_000;

export type CollectionRunStartResult =
  | {
      readonly kind: typeof COLLECTION_RUN_START_KINDS.STARTED;
      readonly run: CollectionRun;
    }
  | {
      readonly kind: typeof COLLECTION_RUN_START_KINDS.REJECTED;
      readonly retryNotBeforeAt: Date;
    };

export interface SuccessfulRunInput {
  runId: string;
  profiles: GithubObservation[];
  repositories: GithubObservation[];
  events: GithubObservation[];
}

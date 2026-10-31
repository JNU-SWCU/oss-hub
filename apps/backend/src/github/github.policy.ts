import {
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import { RunDeadlineError } from './collection-inventory.error';

export interface RequestFingerprint {
  readonly endpoint: string;
  readonly ref: string | null;
  readonly query: string;
  readonly order: string | null;
  readonly pageSize: number;
  readonly accept: string;
  readonly apiVersion: string;
}

export function requestFingerprintKey(fingerprint: RequestFingerprint): string {
  return [
    fingerprint.endpoint,
    fingerprint.ref ?? '',
    fingerprint.query,
    fingerprint.order ?? '',
    String(fingerprint.pageSize),
    fingerprint.accept,
    fingerprint.apiVersion,
  ].join('\u001f');
}

export interface PullRequestFrontier {
  readonly createdAt: string;
  readonly id: string;
}

export type IssueFrontier = PullRequestFrontier;

export interface ReleaseFrontier {
  readonly probe: string;
}

export const splitNameWithOwner = (nameWithOwner: string): [string, string] => {
  const index = nameWithOwner.indexOf('/');
  if (index < 0) {
    throw new Error(
      `invalid collection repository nameWithOwner: ${nameWithOwner}`,
    );
  }
  return [nameWithOwner.slice(0, index), nameWithOwner.slice(index + 1)];
};

export const PUBLISH_BLOCKED_REASONS = {
  REPOSITORY_NOT_READY: 'REPOSITORY_NOT_READY',
  REPOSITORY_PUBLICATION_NOT_PLANNED: 'REPOSITORY_PUBLICATION_NOT_PLANNED',
  PROGRAM_NOT_ENDED: 'PROGRAM_NOT_ENDED',
  REQUIRED_MILESTONES_NOT_APPROVED: 'REQUIRED_MILESTONES_NOT_APPROVED',
} as const;

export type PublishBlockedReason =
  (typeof PUBLISH_BLOCKED_REASONS)[keyof typeof PUBLISH_BLOCKED_REASONS];

export interface RepositoryPublishEligibility {
  readonly repositoryId: string;
  readonly visibility: RepositoryVisibility;
  readonly provisionStatus: RepositoryProvisionJobStatus | null;
  readonly requiredMilestonesApproved: boolean;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly programEndAt: Date;
}

export function publishBlockedReasons(
  eligibility: Omit<RepositoryPublishEligibility, 'repositoryId'>,
  now: Date,
): readonly PublishBlockedReason[] {
  if (eligibility.visibility !== RepositoryVisibility.PRIVATE) return [];
  return [
    ...(eligibility.provisionStatus === RepositoryProvisionJobStatus.SUCCEEDED
      ? []
      : [PUBLISH_BLOCKED_REASONS.REPOSITORY_NOT_READY]),
    ...(eligibility.isRepositoryPublicationPlanned
      ? []
      : [PUBLISH_BLOCKED_REASONS.REPOSITORY_PUBLICATION_NOT_PLANNED]),
    ...(eligibility.programEndAt.getTime() <= now.getTime()
      ? []
      : [PUBLISH_BLOCKED_REASONS.PROGRAM_NOT_ENDED]),
    ...(eligibility.requiredMilestonesApproved
      ? []
      : [PUBLISH_BLOCKED_REASONS.REQUIRED_MILESTONES_NOT_APPROVED]),
  ];
}

export class CollectionSyncDeadline {
  constructor(private readonly now: () => Date) {}

  async run<T>(operation: Promise<T>, deadline: number): Promise<T> {
    const remaining = deadline - this.now().getTime();
    if (remaining <= 0) throw new RunDeadlineError();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new RunDeadlineError()), remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

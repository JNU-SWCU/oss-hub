import type { PublishBlockedReason } from '../github/domain/repository-publication';
import type { TeamRepositoryEvidenceView } from './program-team-repository-evidence.types';
import type { TeamDeletionScopeCounts } from './domain/team-deletion-scope';

export interface TeamMemberView {
  readonly userId: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly isLeader: boolean;
}

export interface CreatedTeamView {
  readonly id: string;
  readonly name: string;
  readonly joinCode: string;
  readonly memberCount: number;
}

export interface RenamedTeamView {
  readonly teamId: string;
  readonly name: string;
}

export interface StaffTeamView {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly TeamMemberView[];
}

export interface ProgramTeamView {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly minMembers: number;
  readonly maxMembers: number;
  readonly hasApplication: boolean;
  readonly canInvite: boolean;
  readonly canRemoveMembers: boolean;
  readonly canLeave: boolean;
  readonly isLeader: boolean;
  readonly members: readonly TeamMemberView[];
}

export type TeamRepositoryProvisioningJobStatus =
  | 'NOT_REQUESTED'
  | 'DISABLED'
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'RETRYABLE_FAILED'
  | 'FAILED'
  | 'ANOMALOUS';

export type TeamRepositoryProvisioningSafeErrorClass =
  'AUTH' | 'RATE_LIMIT' | 'UPSTREAM_REJECTED' | 'UNKNOWN';

export interface TeamApplicationView {
  readonly id: string;
  readonly status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly repositoryConnectionMode: 'NEW' | 'OWN';
  readonly repository: {
    readonly id: string;
    readonly url: string;
    readonly visibility: 'PUBLIC' | 'PRIVATE';
    readonly publishEligible: boolean;
    readonly blockedReasons: readonly PublishBlockedReason[];
  } | null;
  readonly repositoryProvisioning: {
    readonly enabled: boolean;
    readonly jobStatus: TeamRepositoryProvisioningJobStatus;
    readonly updatedAt: Date;
    readonly safeErrorClass: TeamRepositoryProvisioningSafeErrorClass | null;
  };
}

export interface StaffTeamDetailView extends TeamRepositoryEvidenceView {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly TeamMemberView[];
  readonly application: TeamApplicationView | null;
  readonly deletionScope: TeamDeletionScopeCounts;
}

export interface DeletedTeamView {
  readonly teamId: string;
  readonly deleted: true;
  readonly deletedCounts: Omit<TeamDeletionScopeCounts, 'scopeFingerprint'>;
}

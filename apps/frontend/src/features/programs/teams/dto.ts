import type { ApplicationStatus } from '../program-contract';
import type {
  RepositoryConnectionMode,
  RepositoryProvisioning,
} from '../applications/dto';
import type { PublishBlockedReason } from '@/lib/repository-publication';

export interface TeamMember {
  readonly userId: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly isLeader: boolean;
}

export interface ProgramTeam {
  readonly preparation?: true;
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly minMembers: number | null;
  readonly maxMembers: number;
  readonly hasApplication: boolean;
  readonly canInvite: boolean;
  readonly canRemoveMembers: boolean;
  readonly canLeave: boolean;
  readonly isLeader: boolean;
  readonly members: readonly TeamMember[];
}

export interface CreatedTeam {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
}

export interface StaffProgramTeamMember {
  readonly userId: string;
  readonly name: string | null;
  readonly nickname: string;
  readonly isLeader: boolean;
}

export interface StaffProgramTeam {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly StaffProgramTeamMember[];
}

export interface StaffTeamDetailApplication {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repository: {
    readonly id: string;
    readonly url: string;
    readonly visibility: 'PUBLIC' | 'PRIVATE';
    readonly publishEligible: boolean;
    readonly blockedReasons: readonly PublishBlockedReason[];
  } | null;
  readonly repositoryProvisioning: RepositoryProvisioning;
}

export interface TeamDeletionScope {
  readonly applications: number;
  readonly members: number;
  readonly invitations: number;
  readonly submissions: number;
  readonly submissionEvents: number;
  readonly detachedRepositories: number;
  readonly scopeFingerprint: string;
}

export type TeamDeletedCounts = Omit<TeamDeletionScope, 'scopeFingerprint'>;

export interface DeletedTeamResult {
  readonly teamId: string;
  readonly deleted: true;
  readonly deletedCounts: TeamDeletedCounts;
}

export interface StaffTeamDetail {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly StaffProgramTeamMember[];
  readonly application: StaffTeamDetailApplication | null;

  readonly deletionScope: TeamDeletionScope;

  readonly repositoryContributions: {
    readonly outsiderContributions: StaffOutsiderContributions | null;
  } | null;
}

export interface StaffOutsiderContributions {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
}

export interface RenamedTeam {
  readonly teamId: string;
  readonly name: string;
}

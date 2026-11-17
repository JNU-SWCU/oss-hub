import type {
  RepositoryUrlHistoryPage,
  RepositoryUrlHistoryView,
  StaffTeamDetailView,
  TeamApplicationView,
  TeamRepositoryContributionsView,
} from '../program-team-repository-evidence.repository';
import { PublishableRepositoryResponseDto } from './publishable-repository-response.dto';
import { TeamMemberResponseDto } from './program-team-response.dto';

class RepositoryUrlHistoryItemResponseDto {
  declare readonly id: string;
  declare readonly occurredAt: string;
  declare readonly actorGithubLogin: string;
  declare readonly previousRepositoryUrl: string | null;
  declare readonly newRepositoryUrl: string;

  static from(
    item: RepositoryUrlHistoryView,
  ): RepositoryUrlHistoryItemResponseDto {
    return {
      id: item.id,
      occurredAt: item.occurredAt,
      actorGithubLogin: item.actorGithubLogin,
      previousRepositoryUrl: item.previousRepositoryUrl,
      newRepositoryUrl: item.newRepositoryUrl,
    };
  }
}

export class RepositoryUrlHistoryResponseDto {
  declare readonly items: RepositoryUrlHistoryItemResponseDto[];
  declare readonly nextCursor: string | null;

  static from(view: RepositoryUrlHistoryPage): RepositoryUrlHistoryResponseDto {
    return {
      items: view.items.map((item) =>
        RepositoryUrlHistoryItemResponseDto.from(item),
      ),
      nextCursor: view.nextCursor,
    };
  }
}

class RepositoryContributorResponseDto {
  declare readonly userId: string;
  declare readonly githubId: string;
  declare readonly hasObservations: boolean;
  declare readonly commitCount: number;
  declare readonly pullRequestCount: number;
  declare readonly releaseCount: number;
  declare readonly issueCount: number;

  static from(
    member: TeamRepositoryContributionsView['members'][number],
  ): RepositoryContributorResponseDto {
    return {
      userId: member.userId,
      githubId: member.githubId,
      hasObservations: member.hasObservations,
      commitCount: member.commitCount,
      pullRequestCount: member.pullRequestCount,
      releaseCount: member.releaseCount,
      issueCount: member.issueCount,
    };
  }
}

class RepositoryContributionsResponseDto {
  declare readonly repositoryId: string;
  declare readonly repositoryUrl: string;
  declare readonly window: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: TeamRepositoryContributionsView['window']['timeZone'];
  };
  declare readonly collectionStatus: TeamRepositoryContributionsView['collectionStatus'];
  declare readonly lastSuccessAt: string | null;
  declare readonly members: RepositoryContributorResponseDto[];

  static from(
    view: TeamRepositoryContributionsView,
  ): RepositoryContributionsResponseDto {
    return {
      repositoryId: view.repositoryId,
      repositoryUrl: view.repositoryUrl,
      window: view.window,
      collectionStatus: view.collectionStatus,
      lastSuccessAt: view.lastSuccessAt,
      members: view.members.map((member) =>
        RepositoryContributorResponseDto.from(member),
      ),
    };
  }
}

export class TeamApplicationResponseDto {
  declare readonly id: string;
  declare readonly status: TeamApplicationView['status'];
  declare readonly repositoryConnectionMode: TeamApplicationView['repositoryConnectionMode'];
  declare readonly repository: PublishableRepositoryResponseDto | null;
  declare readonly repositoryProvisioning: {
    readonly enabled: boolean;
    readonly jobStatus: TeamApplicationView['repositoryProvisioning']['jobStatus'];
    readonly updatedAt: string;
    readonly safeErrorClass: TeamApplicationView['repositoryProvisioning']['safeErrorClass'];
  };

  static from(view: TeamApplicationView): TeamApplicationResponseDto {
    return {
      id: view.id,
      status: view.status,
      repositoryConnectionMode: view.repositoryConnectionMode,
      repository: view.repository
        ? PublishableRepositoryResponseDto.from(view.repository)
        : null,
      repositoryProvisioning: {
        enabled: view.repositoryProvisioning.enabled,
        jobStatus: view.repositoryProvisioning.jobStatus,
        updatedAt: view.repositoryProvisioning.updatedAt.toISOString(),
        safeErrorClass: view.repositoryProvisioning.safeErrorClass,
      },
    };
  }
}

export class StaffTeamDetailResponseDto {
  declare readonly teamId: string;
  declare readonly name: string;
  declare readonly memberCount: number;
  declare readonly members: TeamMemberResponseDto[];
  declare readonly application: TeamApplicationResponseDto | null;
  declare readonly repositoryContributions: RepositoryContributionsResponseDto | null;
  declare readonly repositoryUrlHistory: RepositoryUrlHistoryResponseDto;

  declare readonly deletionScope: {
    readonly teams: number;
    readonly members: number;
    readonly invitations: number;
    readonly submissions: number;
    readonly submissionEvents: number;
    readonly detachedRepositories: number;
    readonly scopeFingerprint: string;
  };

  static from(view: StaffTeamDetailView): StaffTeamDetailResponseDto {
    return {
      teamId: view.teamId,
      name: view.name,
      memberCount: view.memberCount,
      members: view.members.map((member) => TeamMemberResponseDto.from(member)),
      application: view.application
        ? TeamApplicationResponseDto.from(view.application)
        : null,
      repositoryContributions: view.repositoryContributions
        ? RepositoryContributionsResponseDto.from(view.repositoryContributions)
        : null,
      repositoryUrlHistory: RepositoryUrlHistoryResponseDto.from(
        view.repositoryUrlHistory,
      ),
      deletionScope: view.deletionScope,
    };
  }
}

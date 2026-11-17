import type {
  RepositoryUrlHistoryPage,
  RepositoryUrlHistoryView,
  StaffTeamDetailView,
  TeamApplicationView,
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

export class TeamApplicationResponseDto {
  declare readonly id: string;
  declare readonly status: TeamApplicationView['status'];
  declare readonly repositoryConnectionMode: TeamApplicationView['repositoryConnectionMode'];
  declare readonly repository: PublishableRepositoryResponseDto | null;
  declare readonly repositoryProvisioning: {
    readonly enabled: boolean;
    readonly jobStatus: TeamApplicationView['repositoryProvisioning']['jobStatus'];
    readonly updatedAt: string;
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
      deletionScope: view.deletionScope,
    };
  }
}

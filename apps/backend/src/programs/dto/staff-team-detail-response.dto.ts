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
  declare readonly status: TeamApplicationView['status'];
  declare readonly repositoryConnectionMode: TeamApplicationView['repositoryConnectionMode'];
  declare readonly repository: PublishableRepositoryResponseDto | null;
  declare readonly repositoryProvisioning: {
    readonly jobStatus: TeamApplicationView['repositoryProvisioning']['jobStatus'];
  };

  static from(view: TeamApplicationView): TeamApplicationResponseDto {
    return {
      status: view.status,
      repositoryConnectionMode: view.repositoryConnectionMode,
      repository: view.repository
        ? PublishableRepositoryResponseDto.from(view.repository)
        : null,
      repositoryProvisioning: {
        jobStatus: view.repositoryProvisioning.jobStatus,
      },
    };
  }
}

export class StaffTeamDetailResponseDto {
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

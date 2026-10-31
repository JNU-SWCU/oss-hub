import type {
  StaffTeamDetailView,
  TeamApplicationView,
  TeamMemberView,
  RepositoryUrlHistoryPage,
} from '../program-teams.types';

export class RepositoryUrlHistoryResponseDto {
  declare readonly items: RepositoryUrlHistoryPage['items'];
  declare readonly nextCursor: string | null;

  static from(view: RepositoryUrlHistoryPage): RepositoryUrlHistoryResponseDto {
    return { items: view.items, nextCursor: view.nextCursor };
  }
}

export class TeamApplicationResponseDto {
  declare readonly id: string;
  declare readonly status: TeamApplicationView['status'];
  declare readonly repositoryConnectionMode: TeamApplicationView['repositoryConnectionMode'];
  declare readonly repository: TeamApplicationView['repository'];
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
      repository: view.repository,
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
  declare readonly members: readonly TeamMemberView[];
  declare readonly application: TeamApplicationResponseDto | null;
  declare readonly repositoryContributions: StaffTeamDetailView['repositoryContributions'];
  declare readonly repositoryUrlHistory: StaffTeamDetailView['repositoryUrlHistory'];

  declare readonly deletionScope: StaffTeamDetailView['deletionScope'];

  static from(view: StaffTeamDetailView): StaffTeamDetailResponseDto {
    return {
      teamId: view.teamId,
      name: view.name,
      memberCount: view.memberCount,
      members: view.members,
      application: view.application
        ? TeamApplicationResponseDto.from(view.application)
        : null,
      repositoryContributions: view.repositoryContributions,
      repositoryUrlHistory: view.repositoryUrlHistory,
      deletionScope: view.deletionScope,
    };
  }
}

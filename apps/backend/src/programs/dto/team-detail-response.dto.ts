import type {
  StaffTeamDetailView,
  TeamApplicationView,
  TeamMemberView,
} from '../domain/program-teams.types';
import type { RepositoryUrlHistoryPage } from '../domain/program-team-repository-evidence.types';

export class RepositoryUrlHistoryResponseDto {
  readonly items: RepositoryUrlHistoryPage['items'];
  readonly nextCursor: string | null;

  private constructor(view: RepositoryUrlHistoryPage) {
    this.items = view.items;
    this.nextCursor = view.nextCursor;
  }

  static from(view: RepositoryUrlHistoryPage): RepositoryUrlHistoryResponseDto {
    return new RepositoryUrlHistoryResponseDto(view);
  }
}

export class TeamApplicationResponseDto {
  readonly id: string;
  readonly status: TeamApplicationView['status'];
  readonly repositoryConnectionMode: TeamApplicationView['repositoryConnectionMode'];
  readonly repository: TeamApplicationView['repository'];
  readonly repositoryProvisioning: {
    readonly enabled: boolean;
    readonly jobStatus: TeamApplicationView['repositoryProvisioning']['jobStatus'];
    readonly updatedAt: string;
    readonly safeErrorClass: TeamApplicationView['repositoryProvisioning']['safeErrorClass'];
  };

  private constructor(view: TeamApplicationView) {
    this.id = view.id;
    this.status = view.status;
    this.repositoryConnectionMode = view.repositoryConnectionMode;
    this.repository = view.repository;
    this.repositoryProvisioning = {
      ...view.repositoryProvisioning,
      updatedAt: view.repositoryProvisioning.updatedAt.toISOString(),
    };
  }

  static from(view: TeamApplicationView): TeamApplicationResponseDto {
    return new TeamApplicationResponseDto(view);
  }
}

export class StaffTeamDetailResponseDto {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly TeamMemberView[];
  readonly application: TeamApplicationResponseDto | null;
  readonly repositoryContributions: StaffTeamDetailView['repositoryContributions'];
  readonly repositoryUrlHistory: StaffTeamDetailView['repositoryUrlHistory'];

  readonly deletionScope: StaffTeamDetailView['deletionScope'];

  private constructor(view: StaffTeamDetailView) {
    this.teamId = view.teamId;
    this.name = view.name;
    this.memberCount = view.memberCount;
    this.members = view.members;
    this.repositoryContributions = view.repositoryContributions;
    this.repositoryUrlHistory = view.repositoryUrlHistory;
    this.application = view.application
      ? TeamApplicationResponseDto.from(view.application)
      : null;
    this.deletionScope = view.deletionScope;
  }

  static from(view: StaffTeamDetailView): StaffTeamDetailResponseDto {
    return new StaffTeamDetailResponseDto(view);
  }
}

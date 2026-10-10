import type { TeamActivityView } from '../domain/program-team-repository-evidence.types';

export class TeamActivityResponseDto {
  readonly applicationId: string | null;
  readonly repository: TeamActivityView['repository'];
  readonly status: TeamActivityView['status'];
  readonly lastSuccessAt: string | null;
  readonly window: TeamActivityView['window'];
  readonly canEditRepositoryUrl: boolean;
  readonly members: TeamActivityView['members'];

  private constructor(view: TeamActivityView) {
    this.applicationId = view.applicationId;
    this.repository = view.repository;
    this.status = view.status;
    this.lastSuccessAt = view.lastSuccessAt;
    this.window = view.window;
    this.canEditRepositoryUrl = view.canEditRepositoryUrl;
    this.members = view.members;
  }

  static from(view: TeamActivityView): TeamActivityResponseDto {
    return new TeamActivityResponseDto(view);
  }
}

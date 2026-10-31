import type { TeamActivityView } from '../program-teams.types';

export class TeamActivityResponseDto {
  declare readonly applicationId: string | null;
  declare readonly repository: TeamActivityView['repository'];
  declare readonly status: TeamActivityView['status'];
  declare readonly lastSuccessAt: string | null;
  declare readonly window: TeamActivityView['window'];
  declare readonly canEditRepositoryUrl: boolean;
  declare readonly members: TeamActivityView['members'];

  static from(view: TeamActivityView): TeamActivityResponseDto {
    return {
      applicationId: view.applicationId,
      repository: view.repository,
      status: view.status,
      lastSuccessAt: view.lastSuccessAt,
      window: view.window,
      canEditRepositoryUrl: view.canEditRepositoryUrl,
      members: view.members,
    };
  }
}

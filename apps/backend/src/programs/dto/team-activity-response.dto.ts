import type { TeamActivityView } from '../program-team-repository-evidence.types';

/**
 * `GET /programs/:programId/teams/:teamId/activity` 응답(#1133). 학생과 교직원이 같은
 * 모양을 받고, 역할에 따라 달라지는 칸은 `canEditRepositoryUrl` 하나뿐이다.
 */
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

import type {
  StaffTeamDetailView,
  TeamApplicationView,
  TeamMemberView,
} from '../program-teams.types';

/**
 * 교직원 전용 팀 상세(#874) 응답 — 팀원(실명 포함)·신청 상태·저장소 발급 상태를
 * 한 요청으로 담는다. 학번·학과·연락처·이메일·참여코드는 담지 않는다.
 *
 * `repository`(url·visibility)는 의도적으로 포함한다 — 같은 교직원이 신청 목록/상세
 * (`ApplicationListItemResponseDto.repository`)에서 이미 보는 값이라, 팀 상세에서
 * 감추면 저장소 상태를 보려고 다시 신청 화면으로 돌아가야 해서 "한 요청으로 끝나야
 * 한다"는 이슈 요구를 어긴다. forbidden-field 테스트는 이 결정에 맞춰 `repository`·
 * `url`을 금지어에서 제외한다(PR 본문 참고).
 */
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

  private constructor(view: StaffTeamDetailView) {
    this.teamId = view.teamId;
    this.name = view.name;
    this.memberCount = view.memberCount;
    this.members = view.members;
    this.application = view.application
      ? TeamApplicationResponseDto.from(view.application)
      : null;
  }

  static from(view: StaffTeamDetailView): StaffTeamDetailResponseDto {
    return new StaffTeamDetailResponseDto(view);
  }
}

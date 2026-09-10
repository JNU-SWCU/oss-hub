import type { PublishBlockedReason } from '../common/repository-publication';

export interface TeamMemberView {
  readonly userId: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly isLeader: boolean;
}

export interface CreatedTeamView {
  readonly id: string;
  readonly name: string;
  readonly joinCode: string;
  readonly memberCount: number;
}

/**
 * 교직원 전용 팀 목록의 한 팀 — 팀원 전원의 실명을 포함한다.
 * 학번·학과·연락처·이메일·참여코드·저장소 URL 은 담지 않는다.
 */
export interface StaffTeamView {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly TeamMemberView[];
}

/**
 * 로그인한 학생이 보는 내 팀 — 화면이 버튼을 켜고 끌 때 쓰는 능력을 서버가 계산해서
 * 내려준다. 과거의 `locked`(신청 제출 여부 하나로 모든 팀 편집을 잠그던 플래그)는
 * 없앴다: 신청이 있어도 팀장은 초대·제외를 계속할 수 있고, 팀원은 스스로 나갈 수
 * 있으며, 오직 "신청 이력이 있는 팀의 마지막 한 명"만 팀을 비울 수 없다.
 *
 * - `hasApplication`: 이 팀 이름으로 제출된 신청이 있는지(사실 표기용).
 * - `canInvite`: 팀장만 초대할 수 있다.
 * - `canRemoveMembers`: 팀장이고 자기 말고 다른 팀원이 있을 때만 제외할 수 있다.
 * - `canLeave`: 다른 팀원이 남아 있거나, 신청 이력이 없어 팀이 사라져도 되는 경우.
 */
export interface ProgramTeamView {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly minMembers: number;
  readonly maxMembers: number;
  readonly hasApplication: boolean;
  readonly canInvite: boolean;
  readonly canRemoveMembers: boolean;
  readonly canLeave: boolean;
  readonly isLeader: boolean;
  readonly members: readonly TeamMemberView[];
}

/**
 * `applications.repository.ts`의 `RepositoryProvisioningJobStatus`/
 * `RepositoryProvisioningSafeErrorClass`와 값이 같은 로컬 재선언이다. import 하지
 * 않는 이유: `ApplicationsModule`이 이미 `ProgramsModule`을 import 하므로
 * `ProgramsModule`이 거꾸로 `ApplicationsModule`을 import 하면 순환 의존이 생긴다.
 */
export type TeamRepositoryProvisioningJobStatus =
  | 'NOT_REQUESTED'
  | 'DISABLED'
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'RETRYABLE_FAILED'
  | 'FAILED'
  | 'ANOMALOUS';

export type TeamRepositoryProvisioningSafeErrorClass =
  'AUTH' | 'RATE_LIMIT' | 'UPSTREAM_REJECTED' | 'UNKNOWN';

/**
 * 팀 상세의 신청·저장소 발급 상태 — 팀 상세 화면이 한 요청으로 끝나도록
 * `Application`을 거쳐 함께 싣는다(#874). 신청이 없으면 전체가 null.
 *
 * 저장소는 `Application`을 거쳐서만 읽는다 — `Repository.applicationId`는
 * 필수+unique 라 빠짐이 없지만, `Repository.teamId`는 nullable이라 `Team.repositories`로
 * 조회하면 저장소가 실제로 있는데도 못 찾는 행이 생긴다.
 */
export interface TeamApplicationView {
  readonly id: string;
  readonly status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly repositoryConnectionMode: 'NEW' | 'OWN';
  readonly repository: {
    readonly id: string;
    readonly url: string;
    readonly visibility: 'PUBLIC' | 'PRIVATE';
    readonly publishEligible: boolean;
    readonly blockedReasons: readonly PublishBlockedReason[];
  } | null;
  readonly repositoryProvisioning: {
    readonly enabled: boolean;
    readonly jobStatus: TeamRepositoryProvisioningJobStatus;
    readonly updatedAt: Date;
    readonly safeErrorClass: TeamRepositoryProvisioningSafeErrorClass | null;
  };
}

/**
 * 교직원 전용 팀 상세(#874) — `listForStaff`의 한 팀에 신청·저장소 발급 상태를
 * 더한 모양이다. 학번·학과·연락처·이메일·참여코드는 여전히 담지 않는다.
 */
export interface StaffTeamDetailView {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly TeamMemberView[];
  readonly application: TeamApplicationView | null;
}

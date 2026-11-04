export type PreparationFailure =
  | 'not-found'
  | 'leader-required'
  | 'member-required'
  | 'period-closed'
  | 'membership-conflict'
  | 'full'
  | 'not-pending'
  | 'ineligible'
  | 'self-invite';

export class PreparationConflict extends Error {
  constructor(readonly reason: PreparationFailure) {
    super(reason);
  }
}

export interface PreparationView {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly minMembers: number;
  readonly maxMembers: number;
  readonly isLeader: boolean;
  readonly members: readonly {
    readonly userId: string;
    readonly nickname: string;
    readonly name: string | null;
    readonly isLeader: boolean;
  }[];
}

export interface PreparationInvitation {
  readonly id: string;
  readonly teamId: string;
  readonly programId: string;
  readonly invitedById: string;
  readonly status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
  readonly invitedAt: Date;
  readonly respondedAt: Date | null;
  readonly teamName: string;
  readonly programName: string;
  readonly invitedByDisplayName: string;
  readonly memberCount: number;
  readonly teamMaxSize: number;
  readonly invitee: {
    readonly id: string;
    readonly nickname: string;
    readonly name: string | null;
    readonly avatarUrl: string | null;
  };
}

import type { MemberKind, StaffAccessRequestStatus } from '@prisma/client';
import type { MemberUser, StaffAccessRequestRecord } from './member-onboarding';

export type StaffAccessRequestTarget = {
  readonly id: string;
  readonly memberKind: MemberKind;
  readonly hasStaffAccess: boolean;
};

export type StaffAccessRequestOutcome = {
  readonly requestStatus: StaffAccessRequestStatus | null;
};

export interface OnboardingTransactionStore {
  findUserByGithubId(githubId: bigint): Promise<MemberUser | null>;
  updateSelectedMemberKind(
    userId: string,
    memberKind: MemberKind,
  ): Promise<MemberUser>;
  findPendingRequest(userId: string): Promise<StaffAccessRequestRecord | null>;
  findLatestRequest(userId: string): Promise<StaffAccessRequestRecord | null>;
  createPendingRequest(userId: string): Promise<StaffAccessRequestRecord>;
  requestStaffAccess(
    target: StaffAccessRequestTarget,
  ): Promise<StaffAccessRequestOutcome>;
}

export interface OnboardingRepositoryPort {
  withTransaction<T>(
    operation: (store: OnboardingTransactionStore) => Promise<T>,
  ): Promise<T>;
  findUserByGithubId(githubId: bigint): Promise<MemberUser | null>;
  findLatestRequest(userId: string): Promise<StaffAccessRequestRecord | null>;
}

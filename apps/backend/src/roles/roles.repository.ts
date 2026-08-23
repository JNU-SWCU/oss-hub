import { Injectable } from '@nestjs/common';
import { MemberKind, Prisma, StaffAccessRequestStatus } from '@prisma/client';
import type {
  Prisma as PrismaTypes,
  StaffAccessRequest as PrismaStaffAccessRequest,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  MemberUser,
  StaffAccessRequestRecord,
} from './domain/member-onboarding';
import { requestStaffAccess } from './staff-access-request';
import type {
  StaffAccessRequestOutcome,
  StaffAccessRequestTarget,
} from './staff-access-request';

/**
 * 회원 유형 판단에 필요한 사용자 필드.
 *
 * 프로필 값까지 함께 읽는다 — 선택 화면이 "여기서 요청을 열지"를 판단하려면 지금
 * 프로필이 완료돼 있는지 알아야 한다(`domain/member-onboarding.ts`의 `MemberUser.profile`).
 */
const MEMBER_USER_SELECT = {
  id: true,
  selectedMemberKind: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  accountStatus: true,
  profile: {
    select: {
      name: true,
      studentId: true,
      department: true,
      memberKind: true,
    },
  },
} as const satisfies PrismaTypes.UserSelect;

type MemberUserRow = PrismaTypes.UserGetPayload<{
  select: typeof MEMBER_USER_SELECT;
}>;

export interface RolesTransactionStore {
  findUserByGithubId(githubId: bigint): Promise<MemberUser | null>;
  /**
   * 고른 회원 유형을 기록한다 — 확정이 아니다(#569).
   * 확정은 프로필이 만들어질 때 일어난다.
   */
  updateSelectedMemberKind(
    userId: string,
    memberKind: MemberKind,
  ): Promise<MemberUser>;
  findPendingRequest(userId: string): Promise<StaffAccessRequestRecord | null>;
  findLatestRequest(userId: string): Promise<StaffAccessRequestRecord | null>;
  createPendingRequest(userId: string): Promise<StaffAccessRequestRecord>;
  /**
   * 교직원 접근 요청을 연다 — 규칙은 `staff-access-request.ts`가 하나로 들고 있다.
   *
   * 트랜잭션 클라이언트를 그대로 내놓지 않고 이 문 하나로 감싸는 이유는, 내놓는 순간
   * 호출부가 규칙을 우회해 요청을 직접 만드는 길이 열리기 때문이다.
   */
  requestStaffAccess(
    target: StaffAccessRequestTarget,
  ): Promise<StaffAccessRequestOutcome>;
}

export interface RolesRepositoryPort {
  withTransaction<T>(
    operation: (store: RolesTransactionStore) => Promise<T>,
  ): Promise<T>;
  findUserByGithubId(githubId: bigint): Promise<MemberUser | null>;
  findLatestRequest(userId: string): Promise<StaffAccessRequestRecord | null>;
}

class PrismaRolesTransactionStore implements RolesTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  requestStaffAccess(
    target: StaffAccessRequestTarget,
  ): Promise<StaffAccessRequestOutcome> {
    return requestStaffAccess(this.transaction, target);
  }

  async findUserByGithubId(githubId: bigint): Promise<MemberUser | null> {
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "User" WHERE "githubId" = ${githubId} FOR UPDATE`,
    );
    const user = await this.transaction.user.findUnique({
      where: { githubId },
      select: MEMBER_USER_SELECT,
    });
    return user ? toMemberUser(user) : null;
  }

  async updateSelectedMemberKind(
    userId: string,
    memberKind: MemberKind,
  ): Promise<MemberUser> {
    const user = await this.transaction.user.update({
      where: { id: userId },
      data: { selectedMemberKind: memberKind },
      select: MEMBER_USER_SELECT,
    });
    return toMemberUser(user);
  }

  async findPendingRequest(
    userId: string,
  ): Promise<StaffAccessRequestRecord | null> {
    const request = await this.transaction.staffAccessRequest.findFirst({
      where: { userId, status: StaffAccessRequestStatus.PENDING },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return request ? toStaffAccessRequest(request) : null;
  }

  async findLatestRequest(
    userId: string,
  ): Promise<StaffAccessRequestRecord | null> {
    const request = await this.transaction.staffAccessRequest.findFirst({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return request ? toStaffAccessRequest(request) : null;
  }

  async createPendingRequest(
    userId: string,
  ): Promise<StaffAccessRequestRecord> {
    const request = await this.transaction.staffAccessRequest.create({
      data: { userId },
    });
    return toStaffAccessRequest(request);
  }
}

@Injectable()
export class RolesRepository implements RolesRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(
    operation: (store: RolesTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaRolesTransactionStore(transaction)),
    );
  }

  async findUserByGithubId(githubId: bigint): Promise<MemberUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: MEMBER_USER_SELECT,
    });
    return user ? toMemberUser(user) : null;
  }

  async findLatestRequest(
    userId: string,
  ): Promise<StaffAccessRequestRecord | null> {
    const request = await this.prisma.staffAccessRequest.findFirst({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return request ? toStaffAccessRequest(request) : null;
  }
}

function toMemberUser(user: MemberUserRow): MemberUser {
  return {
    id: user.id,
    memberKind: user.profile?.memberKind ?? null,
    selectedMemberKind: user.selectedMemberKind,
    hasStaffAccess: user.hasStaffAccess,
    hasAdminAccess: user.hasAdminAccess,
    accountStatus: user.accountStatus,
    profile: {
      name: user.profile?.name ?? null,
      studentId: user.profile?.studentId ?? null,
      department: user.profile?.department ?? null,
    },
  };
}

function toStaffAccessRequest(
  request: PrismaStaffAccessRequest,
): StaffAccessRequestRecord {
  return {
    id: request.id,
    userId: request.userId,
    status: request.status,
    rejectionReason: request.rejectionReason,
    decidedAt: request.decidedAt,
    createdAt: request.createdAt,
  };
}

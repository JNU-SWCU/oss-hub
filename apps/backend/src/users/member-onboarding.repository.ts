import { Injectable } from '@nestjs/common';
import {
  Consent as PrismaConsent,
  Prisma,
  MemberKind,
  StaffAccessRequestStatus,
  type Prisma as PrismaTypes,
  type StaffAccessRequest as PrismaStaffAccessRequest,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  ConsentRecord,
  ConsentUser,
  type MemberUser,
  type StaffAccessRequestRecord,
} from './users.types';
import {
  type StaffAccessRequestOutcome,
  type StaffAccessRequestTarget,
  PlatformRepository,
} from '../platform/platform.repository';

@Injectable()
export class ConsentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByGithubId(githubId: bigint): Promise<ConsentUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: { id: true, accountStatus: true },
    });
    return user ? { id: user.id, accountStatus: user.accountStatus } : null;
  }

  async findConsent(
    userId: string,
    policyVersion: string,
  ): Promise<ConsentRecord | null> {
    const consent = await this.prisma.consent.findUnique({
      where: { userId_policyVersion: { userId, policyVersion } },
    });
    return consent ? this.toDomain(consent) : null;
  }

  async createConsent(
    userId: string,
    policyVersion: string,
  ): Promise<ConsentRecord> {
    try {
      const created = await this.prisma.consent.create({
        data: { userId, policyVersion },
      });
      return this.toDomain(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.findConsent(userId, policyVersion);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  private toDomain(consent: PrismaConsent): ConsentRecord {
    return {
      policyVersion: consent.policyVersion,
      consentedAt: consent.consentedAt,
    };
  }
}

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

class PrismaOnboardingTransactionRepository implements OnboardingTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  requestStaffAccess(
    target: StaffAccessRequestTarget,
  ): Promise<StaffAccessRequestOutcome> {
    return PlatformRepository.requestStaffAccess(this.transaction, target);
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
export class MemberOnboardingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(
    operation: (store: OnboardingTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaOnboardingTransactionRepository(transaction)),
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

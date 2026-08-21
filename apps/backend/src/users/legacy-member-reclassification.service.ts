import { Inject, Injectable } from '@nestjs/common';
import { AffiliationKind, MemberKind, Prisma, Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { SystemErrorCode } from '../common/system-error-code.enum';
import {
  LegacyMemberReclassificationRepository,
  type LegacyMemberReclassificationRecord,
  type LegacyMemberReclassificationRepositoryPort,
} from './legacy-member-reclassification.repository';
import {
  isValidDepartment,
  isValidStudentId,
  isValidUserName,
  normalizeProfileText,
} from './user-profile-policy';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.enum';

export type LegacyMemberReclassificationInput = {
  readonly memberKind: MemberKind;
  readonly name: string;
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
  readonly studentId?: string;
};

export type LegacyMemberReclassificationResult = {
  readonly memberKind: MemberKind;
  readonly name: string;
  readonly studentId: string | null;
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: true;
};

@Injectable()
export class LegacyMemberReclassificationService {
  constructor(
    @Inject(LegacyMemberReclassificationRepository)
    private readonly repository: LegacyMemberReclassificationRepositoryPort,
  ) {}

  async reclassify(
    githubId: bigint,
    input: LegacyMemberReclassificationInput,
  ): Promise<LegacyMemberReclassificationResult> {
    const desired = desiredResult(input);
    try {
      return await this.repository.withTransaction(async (store) => {
        const current = await store.findByGithubIdForUpdate(githubId);
        requireLegacyAdmin(current);
        if (current.profile?.memberKind !== null && current.profile !== null) {
          if (matchesReplay(current, desired)) return desired;
          throw new DomainException(
            USERS_ERROR_CODES[UsersErrorCode.LEGACY_RECLASSIFICATION_CONFLICT],
          );
        }
        await store.save(current.id, desired);
        return desired;
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_TAKEN],
        );
      }
      throw error;
    }
  }
}

function desiredResult(
  input: LegacyMemberReclassificationInput,
): LegacyMemberReclassificationResult {
  const name = normalizeProfileText(input.name);
  const affiliationName = normalizeProfileText(input.affiliationName);
  if (!isValidUserName(name) || !isValidDepartment(affiliationName)) {
    throw invalidInput('이름 또는 소속 형식이 올바르지 않습니다.');
  }
  switch (input.memberKind) {
    case MemberKind.STUDENT:
      if (
        input.affiliationKind !== AffiliationKind.DEPARTMENT ||
        input.studentId === undefined ||
        !isValidStudentId(input.studentId)
      ) {
        throw invalidInput('학생 회원은 학과와 숫자 6자리 학번이 필요합니다.');
      }
      return {
        memberKind: MemberKind.STUDENT,
        name,
        studentId: input.studentId,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName,
        hasStaffAccess: false,
        hasAdminAccess: true,
      };
    case MemberKind.STAFF:
      if (input.studentId !== undefined) {
        throw invalidInput('교직원 회원은 학번을 저장할 수 없습니다.');
      }
      return {
        memberKind: MemberKind.STAFF,
        name,
        studentId: null,
        affiliationKind: input.affiliationKind,
        affiliationName,
        hasStaffAccess: true,
        hasAdminAccess: true,
      };
  }
}

function requireLegacyAdmin(
  current: LegacyMemberReclassificationRecord | null,
): asserts current is LegacyMemberReclassificationRecord {
  if (
    current === null ||
    current.role !== Role.ADMIN ||
    current.hasAdminAccess !== true ||
    current.selectedRole !== null ||
    !hasLegacyReclassificationState(current)
  ) {
    throw new DomainException(
      USERS_ERROR_CODES[UsersErrorCode.LEGACY_RECLASSIFICATION_NOT_FOUND],
    );
  }
}

function hasLegacyReclassificationState(
  current: LegacyMemberReclassificationRecord,
): boolean {
  const memberKind = current.profile?.memberKind ?? null;
  return (
    (memberKind === null && current.selectedMemberKind === null) ||
    (memberKind !== null && current.selectedMemberKind === memberKind)
  );
}

function matchesReplay(
  current: LegacyMemberReclassificationRecord,
  desired: LegacyMemberReclassificationResult,
): boolean {
  const profile = current.profile;
  return (
    profile !== null &&
    profile.memberKind === desired.memberKind &&
    current.selectedMemberKind === desired.memberKind &&
    profile.name === desired.name &&
    profile.studentId === desired.studentId &&
    profile.department === desired.affiliationName &&
    profile.affiliationKind === desired.affiliationKind &&
    profile.affiliationName === desired.affiliationName &&
    current.name === desired.name &&
    current.studentId === desired.studentId &&
    current.department === desired.affiliationName &&
    current.hasStaffAccess === desired.hasStaffAccess &&
    current.hasAdminAccess === true
  );
}

function invalidInput(message: string): DomainException {
  return new DomainException({
    code: SystemErrorCode.VALIDATION_FAILED,
    status: 400,
    message,
  });
}

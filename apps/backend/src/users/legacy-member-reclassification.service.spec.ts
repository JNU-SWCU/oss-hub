import { AffiliationKind, MemberKind, Role } from '@prisma/client';
import type {
  LegacyMemberReclassificationRecord,
  LegacyMemberReclassificationRepositoryPort,
  LegacyMemberReclassificationStore,
} from './legacy-member-reclassification.repository';
import {
  LegacyMemberReclassificationService,
  type LegacyMemberReclassificationInput,
  type LegacyMemberReclassificationResult,
} from './legacy-member-reclassification.service';

const githubId = 9_910_000_001n;

class ReclassificationStore
  implements
    LegacyMemberReclassificationRepositoryPort,
    LegacyMemberReclassificationStore
{
  current: LegacyMemberReclassificationRecord | null = legacyAdmin();
  saves: LegacyMemberReclassificationResult[] = [];

  withTransaction<T>(
    operation: (store: LegacyMemberReclassificationStore) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  findByGithubIdForUpdate(): Promise<LegacyMemberReclassificationRecord | null> {
    return Promise.resolve(this.current);
  }

  save(
    _userId: string,
    result: LegacyMemberReclassificationResult,
  ): Promise<void> {
    this.saves.push(result);
    const current = this.current;
    if (current !== null) {
      this.current = {
        ...current,
        name: result.name,
        studentId: result.studentId,
        department: result.affiliationName,
        selectedMemberKind: result.memberKind,
        hasStaffAccess: result.hasStaffAccess,
        profile: {
          name: result.name,
          studentId: result.studentId,
          department: result.affiliationName,
          memberKind: result.memberKind,
          affiliationKind: result.affiliationKind,
          affiliationName: result.affiliationName,
        },
      };
    }
    return Promise.resolve();
  }
}

const store = new ReclassificationStore();
const service = new LegacyMemberReclassificationService(store);

beforeEach(() => {
  store.current = legacyAdmin();
  store.saves = [];
});

it('STUDENT reclassification atomically disables staff access', async () => {
  // Given
  const input = studentInput();

  // When
  const result = await service.reclassify(githubId, input);

  // Then
  expect(result).toMatchObject({
    memberKind: MemberKind.STUDENT,
    studentId: '740001',
    hasStaffAccess: false,
    hasAdminAccess: true,
  });
  expect(store.saves).toHaveLength(1);
  expect(store.current?.selectedMemberKind).toBe(MemberKind.STUDENT);
});

it('STAFF reclassification enables staff access and clears student ID', async () => {
  // Given
  const input: LegacyMemberReclassificationInput = {
    memberKind: MemberKind.STAFF,
    name: '  합성 교직원 관리자  ',
    affiliationKind: AffiliationKind.PROGRAM_OFFICE,
    affiliationName: '  합성 사업단  ',
  };

  // When
  const result = await service.reclassify(githubId, input);

  // Then
  expect(result).toMatchObject({
    memberKind: MemberKind.STAFF,
    name: '합성 교직원 관리자',
    studentId: null,
    affiliationName: '합성 사업단',
    hasStaffAccess: true,
    hasAdminAccess: true,
  });
});

it('same replay succeeds without another write', async () => {
  // Given
  const input = studentInput();
  await service.reclassify(githubId, input);
  store.saves = [];

  // When
  const result = await service.reclassify(githubId, input);

  // Then
  expect(result.memberKind).toBe(MemberKind.STUDENT);
  expect(store.saves).toHaveLength(0);
});

it('conflicting replay returns the typed 409 conflict', async () => {
  // Given
  await service.reclassify(githubId, studentInput());

  // When
  const conflict = service.reclassify(githubId, {
    memberKind: MemberKind.STAFF,
    name: '합성 교직원 관리자',
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: '합성 소프트웨어학과',
  });

  // Then
  await expect(conflict).rejects.toMatchObject({
    errorCode: { code: 'USR_012', status: 409 },
  });
});

it.each([
  { role: Role.STUDENT, hasAdminAccess: true, selectedMemberKind: null },
  { role: Role.ADMIN, selectedRole: Role.STUDENT },
  { role: Role.ADMIN, hasAdminAccess: false, selectedMemberKind: null },
  {
    role: Role.ADMIN,
    hasAdminAccess: true,
    selectedMemberKind: MemberKind.STUDENT,
  },
] as const)('nonlegacy combination is hidden as 404', async (patch) => {
  // Given
  store.current = { ...legacyAdmin(), ...patch };

  // When
  const result = service.reclassify(githubId, studentInput());

  // Then
  await expect(result).rejects.toMatchObject({
    errorCode: { code: 'USR_011', status: 404 },
  });
  expect(store.saves).toHaveLength(0);
});

function studentInput(): LegacyMemberReclassificationInput {
  return {
    memberKind: MemberKind.STUDENT,
    name: '  합성 학생 관리자  ',
    studentId: '740001',
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: '  합성 인공지능학부  ',
  };
}

function legacyAdmin(): LegacyMemberReclassificationRecord {
  return {
    id: 'fixture:legacy-admin',
    role: Role.ADMIN,
    selectedRole: null,
    selectedMemberKind: null,
    hasStaffAccess: true,
    hasAdminAccess: true,
    name: '합성 기존 관리자',
    studentId: null,
    department: '합성 운영학과',
    profile: {
      name: '합성 기존 관리자',
      studentId: null,
      department: '합성 운영학과',
      memberKind: null,
      affiliationKind: null,
      affiliationName: null,
    },
  };
}

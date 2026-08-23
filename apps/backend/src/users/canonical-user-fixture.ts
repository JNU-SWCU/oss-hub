import { AccountStatus, AffiliationKind, MemberKind } from '@prisma/client';
import type { Prisma } from '@prisma/client';

/**
 * 통합 테스트가 쓰는 canonical 사용자 생성 입력.
 *
 * 계약 스키마에서는 프로필 행이 곧 "가입을 마쳤다"는 사실이고 세 칸이 NOT NULL이라,
 * 픽스처가 한 사람을 만들 때마다 그 세 값을 함께 정해야 한다. 이 팩토리를 한 곳에 두는
 * 이유는 `UserProfile_*_check` 제약(소속 사본 일치·학번과 유형 대응)을 픽스처마다
 * 다시 맞추다 어긋나는 일을 막기 위해서다.
 */
export type CanonicalUserFixture = {
  readonly id: string;
  readonly githubId: bigint;
  readonly nickname: string;
  readonly memberKind?: MemberKind | null;
  readonly hasStaffAccess?: boolean;
  readonly hasAdminAccess?: boolean;
  readonly accountStatus?: AccountStatus;
  readonly name?: string;
  readonly studentId?: string | null;
  readonly department?: string;
};

const DEFAULT_STUDENT_DEPARTMENT = '합성 학과';
const DEFAULT_STAFF_DEPARTMENT = '합성 사업단';

/**
 * `prisma.user.create({ data })`에 그대로 넣을 수 있는 입력을 만든다.
 *
 * `memberKind`가 `null`이면 프로필을 만들지 않는다 — 아직 가입을 마치지 않은 사람이다.
 * 관리자 권한만 가진 계정도 여기 해당한다(권한은 정체성과 독립이다).
 */
export function canonicalUserCreate(
  fixture: CanonicalUserFixture,
): Prisma.UserCreateInput {
  const memberKind = fixture.memberKind ?? MemberKind.STUDENT;
  const base = {
    id: fixture.id,
    githubId: fixture.githubId,
    nickname: fixture.nickname,
    accountStatus: fixture.accountStatus ?? AccountStatus.ACTIVE,
    selectedMemberKind: fixture.memberKind === null ? null : memberKind,
    hasStaffAccess: fixture.hasStaffAccess ?? false,
    hasAdminAccess: fixture.hasAdminAccess ?? false,
  } satisfies Prisma.UserCreateInput;

  if (fixture.memberKind === null) {
    return base;
  }

  const isStudent = memberKind === MemberKind.STUDENT;
  const department =
    fixture.department ??
    (isStudent ? DEFAULT_STUDENT_DEPARTMENT : DEFAULT_STAFF_DEPARTMENT);
  return {
    ...base,
    profile: {
      create: {
        name: fixture.name ?? `합성 ${fixture.nickname}`,
        // 학번과 회원 유형의 대응은 DB CHECK가 강제한다.
        studentId: isStudent
          ? (fixture.studentId ?? syntheticStudentId(fixture.githubId))
          : null,
        department,
        memberKind,
        affiliationKind: isStudent
          ? AffiliationKind.DEPARTMENT
          : AffiliationKind.PROGRAM_OFFICE,
        // 소속명은 학과의 사본이다 — 두 칸이 어긋나면 CHECK가 거부한다.
        affiliationName: department,
      },
    },
  };
}

/** githubId에서 파생한 결정적 6자리 학번 — 픽스처끼리 충돌하지 않는다. */
export function syntheticStudentId(githubId: bigint): string {
  return String(githubId % 1000000n).padStart(6, '0');
}

/**
 * 픽스처가 여전히 한 단어(`STUDENT`/`STAFF`/`ADMIN`)로 사람을 묘사할 때
 * 그 값을 canonical 세 사실로 펼친다.
 *
 * 시나리오 이름이 읽히게 두면서도 저장은 canonical 칸으로만 하기 위한 얇은 통로다.
 * ADMIN이 회원 유형을 남기지 않는 것은 `auth/initial-roles.ts`와 같은 이유다.
 */
export function authorityFactsFor(label: 'STUDENT' | 'STAFF' | 'ADMIN' | null): {
  readonly selectedMemberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
} {
  switch (label) {
    case 'STUDENT':
      return {
        selectedMemberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
      };
    case 'STAFF':
      return {
        selectedMemberKind: MemberKind.STAFF,
        hasStaffAccess: true,
        hasAdminAccess: false,
      };
    case 'ADMIN':
      return {
        selectedMemberKind: null,
        hasStaffAccess: false,
        hasAdminAccess: true,
      };
    case null:
      return {
        selectedMemberKind: null,
        hasStaffAccess: false,
        hasAdminAccess: false,
      };
  }
}

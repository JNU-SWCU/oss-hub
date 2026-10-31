import { AffiliationKind, MemberKind } from '@prisma/client';
import { profileRecord } from './member-authority-test-fixtures';
import { UsersService } from './users.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { UserProfileService } from './user-profile.service';

const usersService = new UsersService(
  undefined as never,
  undefined as never,
  undefined as never,
  new AuditLogMetadataService(),
  new UserProfileService(),
);

const staffInput = {
  name: '합성 교직원',
  affiliationKind: AffiliationKind.PROGRAM_OFFICE,
  affiliationName: '합성 사업단',
} as const;

describe('가입 마치기의 교직원 접근 승인 요청 판단', () => {
  it.each([
    ['교직원 접근이 없는 교직원', MemberKind.STAFF, false, true],
    ['이미 교직원 접근이 있는 교직원', MemberKind.STAFF, true, false],
  ] as const)(
    '%s는 승인 요청 여부가 %s/%s → %s다',
    (_label, memberKind, hasStaffAccess, expected) => {
      const user = profileRecord('synthetic-staff-request', {
        selectedMemberKind: memberKind,
        hasStaffAccess,
      });

      expect(
        usersService.buildProfileCompletion(user, staffInput)
          .requestsStaffAccess,
      ).toBe(expected);
    },
  );

  it('학생은 승인 요청을 만들지 않는다', () => {
    const user = profileRecord('synthetic-student-request');

    expect(
      usersService.buildProfileCompletion(user, {
        name: '합성 학생',
        studentId: '801030',
        department: '인공지능학부',
        phone: '1'.repeat(11),
      }).requestsStaffAccess,
    ).toBe(false);
  });
});

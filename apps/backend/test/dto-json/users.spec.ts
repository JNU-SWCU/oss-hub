import { AccountDeactivationResponseDto } from '../../src/users/dto/account-deactivation-response.dto';
import { ConsentCurrentResponseDto } from '../../src/users/dto/consent-current-response.dto';
import { ConsentResponseDto } from '../../src/users/dto/consent-response.dto';
import { MyStaffAccessRequestResponseDto } from '../../src/users/dto/my-staff-access-request-response.dto';
import { RoleRequestResponseDto } from '../../src/users/dto/role-request-response.dto';
import {
  MemberKindSelectionStateResponseDto,
  RoleSelectionResponseDto,
} from '../../src/users/dto/role-selection-response.dto';
import { UserProfileResponseDto } from '../../src/users/dto/user-profile-response.dto';
import { CURRENT_CONSENT_POLICY } from '../../src/users/consents.service';
import { type StaffAccessRequestRecord } from '../../src/users/member-onboarding.repository';

const at = (iso: string): Date => new Date(iso);

const pendingRequest: StaffAccessRequestRecord = {
  id: 'request-1',
  userId: 'user-1',
  status: 'PENDING',
  rejectionReason: null,
  decidedAt: null,
  createdAt: at('2026-01-02T03:04:05.000Z'),
};

const rejectedRequest: StaffAccessRequestRecord = {
  ...pendingRequest,
  status: 'REJECTED',
  rejectionReason: 'Not eligible',
  decidedAt: at('2026-01-03T03:04:05.000Z'),
};

const cases: ReadonlyArray<readonly [string, () => unknown]> = [
  [
    'AccountDeactivationResponseDto',
    () => AccountDeactivationResponseDto.from({ accountStatus: 'DEACTIVATED' }),
  ],
  [
    'ConsentCurrentResponseDto',
    () =>
      ConsentCurrentResponseDto.from({
        policy: CURRENT_CONSENT_POLICY,
        consented: false,
      }),
  ],
  [
    'ConsentResponseDto',
    () =>
      ConsentResponseDto.from({
        policyVersion: '2026-10-19',
        consentedAt: at('2026-02-03T04:05:06.000Z'),
        nextUrl: '/onboarding/profile',
      }),
  ],
  [
    'MyStaffAccessRequestResponseDto none',
    () => MyStaffAccessRequestResponseDto.from(null),
  ],
  [
    'MyStaffAccessRequestResponseDto request',
    () => MyStaffAccessRequestResponseDto.from(pendingRequest),
  ],
  [
    'RoleRequestResponseDto pending',
    () => RoleRequestResponseDto.from(pendingRequest),
  ],
  [
    'RoleRequestResponseDto rejected',
    () => RoleRequestResponseDto.from(rejectedRequest),
  ],
  [
    'RoleSelectionResponseDto',
    () =>
      RoleSelectionResponseDto.from({
        selectedMemberKind: 'STUDENT',
        redirectTo: '/onboarding/profile',
      }),
  ],
  [
    'MemberKindSelectionStateResponseDto',
    () =>
      MemberKindSelectionStateResponseDto.from({ selectedMemberKind: null }),
  ],
  [
    'UserProfileResponseDto',
    () =>
      UserProfileResponseDto.from({
        name: 'Octo Cat',
        studentId: '2026000001',
        department: 'Computer Science',
        phone: 'redacted-synthetic-phone',
        staffNumber: null,
        isComplete: true,
      }),
  ],
];

describe('users response DTO JSON', () => {
  it.each(cases)('%s', (_name, build) => {
    expect(JSON.stringify(build())).toMatchSnapshot();
  });
});

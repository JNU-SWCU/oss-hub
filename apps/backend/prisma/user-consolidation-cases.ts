export type BaselineCase = {
  readonly label: string;
  readonly selected: 'STUDENT' | 'STAFF' | null;
  readonly profile: 'STUDENT' | 'STAFF' | null;
  readonly staff?: boolean;
  readonly admin?: boolean;
  readonly incomplete?: boolean;
  readonly retained?: boolean;
  readonly request?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
};

export const BASELINE_CASES = [
  { label: 'unselected', selected: null, profile: null },
  { label: 'selected-student', selected: 'STUDENT', profile: null },
  { label: 'selected-staff', selected: 'STAFF', profile: null },
  { label: 'unselected-admin', selected: null, profile: null, admin: true },
  {
    label: 'selected-staff-admin',
    selected: 'STAFF',
    profile: null,
    admin: true,
  },
  {
    label: 'student-admin',
    selected: 'STUDENT',
    profile: 'STUDENT',
    admin: true,
  },
  {
    label: 'student-admin-staff',
    selected: 'STUDENT',
    profile: 'STUDENT',
    admin: true,
    staff: true,
  },
  {
    label: 'incomplete-student',
    selected: 'STUDENT',
    profile: 'STUDENT',
    incomplete: true,
  },
  {
    label: 'staff-pending',
    selected: 'STAFF',
    profile: 'STAFF',
    request: 'PENDING',
  },
  {
    label: 'staff-approved',
    selected: 'STAFF',
    profile: 'STAFF',
    staff: true,
    request: 'APPROVED',
  },
  {
    label: 'staff-rejected',
    selected: 'STAFF',
    profile: 'STAFF',
    request: 'REJECTED',
  },
  {
    label: 'staff-revoked',
    selected: 'STAFF',
    profile: 'STAFF',
    request: 'REVOKED',
  },
  {
    label: 'staff-retained-id',
    selected: 'STAFF',
    profile: 'STAFF',
    staff: true,
    retained: true,
  },
  { label: 'staff-no-request', selected: 'STAFF', profile: 'STAFF' },
  {
    label: 'staff-access-approved-row-absent',
    selected: 'STAFF',
    profile: 'STAFF',
    staff: true,
  },
  {
    label: 'staff-access-pending',
    selected: 'STAFF',
    profile: 'STAFF',
    staff: true,
    request: 'PENDING',
  },
  {
    label: 'staff-access-rejected',
    selected: 'STAFF',
    profile: 'STAFF',
    staff: true,
    request: 'REJECTED',
  },
  {
    label: 'staff-access-revoked',
    selected: 'STAFF',
    profile: 'STAFF',
    staff: true,
    request: 'REVOKED',
  },
  {
    label: 'staff-without-access-approved',
    selected: 'STAFF',
    profile: 'STAFF',
    request: 'APPROVED',
  },
  {
    label: 'student-old-request',
    selected: 'STUDENT',
    profile: 'STUDENT',
    request: 'REJECTED',
  },
  { label: 'kind-conflict', selected: 'STAFF', profile: 'STUDENT' },
] as const satisfies readonly BaselineCase[];

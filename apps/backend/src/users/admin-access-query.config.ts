import { StaffAccessRequestStatus } from '@prisma/client';

export const ADMIN_ACCESS_ROLE_FILTERS = {
  UNASSIGNED: 'UNASSIGNED',
  STUDENT: 'STUDENT',
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
} as const;

export const ADMIN_ACCESS_PENDING_FILTERS = {
  NONE: 'NONE',
  PENDING: StaffAccessRequestStatus.PENDING,
} as const;

export const ADMIN_ACCESS_SORT_FIELDS = {
  NAME: 'name',
  CREATED_AT: 'createdAt',
  LAST_LOGIN_AT: 'lastLoginAt',
  ROLE: 'role',
  ACCOUNT_STATUS: 'accountStatus',
} as const;

export const ADMIN_ACCESS_SORT_DIRECTIONS = {
  ASC: 'asc',
  DESC: 'desc',
} as const;

export const ADMIN_ACCESS_DEFAULT_SORT = ADMIN_ACCESS_SORT_FIELDS.NAME;

export const ADMIN_ACCESS_DEFAULT_DIRECTION = ADMIN_ACCESS_SORT_DIRECTIONS.ASC;

export const ADMIN_ACCESS_REQUEST_DECISIONS = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
} as const;

export const ADMIN_ACCESS_COMMANDS = {
  GRANT: 'GRANT_ADMIN_ACCESS',
  REVOKE: 'REVOKE_ADMIN_ACCESS',
} as const;

export const STAFF_ACCESS_COMMANDS = {
  GRANT: 'GRANT_STAFF_ACCESS',
  REVOKE: 'REVOKE_STAFF_ACCESS',
} as const;

export const AUTHORITY_TARGETS = {
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
} as const;

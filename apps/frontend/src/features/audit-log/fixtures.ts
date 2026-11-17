const TARGET_DEFAULTS = {
  name: null,
  login: null,
  role: null,
  programName: null,
  teamName: null,
} as const;

export const AUDIT_LOG_ROLE_CHANGE_RECORD_FIXTURE = {
  id: 'audit-role-change',
  occurredAt: '2026-11-17T05:03:00.000Z',
  action: 'USER_ROLE_CHANGED',
  category: 'ACCOUNT',
  actor: {
    id: 'user-admin',
    name: '김예시',
    login: 'synthetic-admin',
    role: 'ADMIN',
  },
  target: {
    ...TARGET_DEFAULTS,
    type: 'USER',
    id: 'user-target',
    name: '박샘플',
    login: 'synthetic-target',
    role: 'STAFF',
  },
  change: { before: 'STUDENT', after: 'STAFF' },
  requestId: null,
  teamMembership: null,
  legacy: false,
  metadata: { schemaVersion: 2, eventKind: 'DIRECT_ROLE_CHANGED' },
} as const;

export const AUDIT_LOG_APPLICATION_RECORD_FIXTURE = {
  id: 'audit-application-approved',
  occurredAt: '2026-11-17T04:10:00.000Z',
  action: 'APPLICATION_APPROVED',
  category: 'OPERATION',
  actor: {
    id: 'user-staff',
    name: '최운영',
    login: 'synthetic-staff',
    role: 'STAFF',
  },
  target: {
    ...TARGET_DEFAULTS,
    type: 'APPLICATION',
    id: 'application-1',
    login: 'synthetic-applicant',
    programName: '합성 클라우드 프로그램',
    teamName: '클라우드 3팀',
  },
  change: { before: 'SUBMITTED', after: 'APPROVED' },
  requestId: null,
  teamMembership: null,
  legacy: false,
  metadata: { schemaVersion: 2 },
} as const;

export const AUDIT_LOG_SUBMISSION_RECORD_FIXTURE = {
  id: 'audit-submission',
  occurredAt: '2026-11-17T03:40:00.000Z',
  action: 'SUBMISSION_RESUBMITTED',
  category: 'SUBMISSION',
  actor: {
    id: 'user-student',
    name: '이예제',
    login: 'synthetic-student',
    role: 'STUDENT',
  },
  target: {
    ...TARGET_DEFAULTS,
    type: 'SUBMISSION',
    id: 'submission-1',
    name: '중간보고서',
    programName: '합성 클라우드 프로그램',
    teamName: '클라우드 1팀',
  },
  change: { before: null, after: '2' },
  requestId: null,
  teamMembership: null,
  legacy: false,
  metadata: { schemaVersion: 1, requirementName: '중간보고서', revision: 2 },
} as const;

export const AUDIT_LOG_SYSTEM_RECORD_FIXTURE = {
  id: 'audit-system',
  occurredAt: '2026-11-16T09:02:00.000Z',
  action: 'GRANT_ADMIN_ACCESS',
  category: 'SYSTEM',
  actor: null,
  target: {
    ...TARGET_DEFAULTS,
    type: 'USER',
    id: 'user-seed',
    login: 'synthetic-seed',
    role: 'ADMIN',
  },
  change: null,
  requestId: null,
  teamMembership: null,
  legacy: false,
  metadata: { schemaVersion: 1, recordKind: 'BOOTSTRAP' },
} as const;

export const AUDIT_LOG_UNKNOWN_ACTOR_RECORD_FIXTURE = {
  id: 'audit-unknown-actor',
  occurredAt: '2026-11-16T08:00:00.000Z',
  action: 'LOGIN',
  category: 'LOGIN',
  actor: {
    id: 'user-nameless',
    name: null,
    login: 'synthetic-nameless',
    role: 'UNSELECTED',
  },
  target: {
    ...TARGET_DEFAULTS,
    type: 'USER',
    id: 'user-nameless',
    login: 'synthetic-nameless',
    role: 'UNSELECTED',
  },
  change: null,
  requestId: null,
  teamMembership: null,
  legacy: false,
  metadata: { schemaVersion: 1, provider: 'github' },
} as const;

export const AUDIT_LOG_PAGE_RESPONSE_FIXTURE = {
  items: [
    AUDIT_LOG_ROLE_CHANGE_RECORD_FIXTURE,
    AUDIT_LOG_APPLICATION_RECORD_FIXTURE,
    AUDIT_LOG_SUBMISSION_RECORD_FIXTURE,
    AUDIT_LOG_SYSTEM_RECORD_FIXTURE,
    AUDIT_LOG_UNKNOWN_ACTOR_RECORD_FIXTURE,
  ],
  total: 5,
  page: 1,
  limit: 20,
  counts: { ACCOUNT: 1, OPERATION: 1, SUBMISSION: 1, LOGIN: 1, SYSTEM: 1 },
} as const;

import type { Prisma } from '@prisma/client';
import type { AuditLogReadRepository } from './audit-log-read.repository';
import { AuditLogReadService } from './audit-log-read.service';
import type { AuditSourceRow, AuditTarget } from './audit-entry.types';
import { AccountAuditSourceService } from './account-audit-source.service';
import { TeamAuditSourceService } from './team-audit-source.service';
import { ProgramAuditSourceService } from './program-audit-source.service';
import { SubmissionAuditSourceService } from './submission-audit-source.service';
import { LoginAuditSourceService } from './login-audit-source.service';

export function createAuditLogReadService(
  repository: Pick<AuditLogReadRepository, 'list'>,
): AuditLogReadService {
  return new AuditLogReadService(
    repository,
    new AccountAuditSourceService(),
    new TeamAuditSourceService(),
    new ProgramAuditSourceService(),
    new SubmissionAuditSourceService(),
    new LoginAuditSourceService(),
  );
}

export const EMPTY_COUNTS = {
  ACCOUNT: 0,
  OPERATION: 0,
  SUBMISSION: 0,
  LOGIN: 0,
  SYSTEM: 0,
} as const;

export function readRows(rows: readonly AuditSourceRow[]) {
  return createAuditLogReadService({
    list: () =>
      Promise.resolve({ rows, total: rows.length, counts: EMPTY_COUNTS }),
  }).list({ page: 1, limit: 20 });
}

export function auditRow(overrides: Partial<AuditSourceRow>): AuditSourceRow {
  return {
    id: 'audit-1',
    source: 'ACCOUNT',
    occurredAt: new Date('2026-07-24T03:00:00.000Z'),
    action: 'SYNTHETIC',
    targetType: 'USER',
    targetId: 'target',
    metadata: {},
    historyKind: null,
    category: 'ACCOUNT',
    actor: null,
    subject: null,
    programName: null,
    teamName: null,
    repositoryName: null,
    ...overrides,
  };
}

export const occurredAt = new Date('2026-07-24T03:00:00.000Z');
export const state = {
  role: 'STAFF',
  accountStatus: 'ACTIVE',
  requestStatus: null,
};
export const people = {
  actor: { displayName: 'Original actor', githubLogin: 'old-actor' },
  target: { displayName: 'Original target', githubLogin: 'old-target' },
};
export const lifecycle = {
  before: { lifecycle: 'PUBLISHED' },
  after: { lifecycle: 'ARCHIVED' },
};
export const visibility = {
  before: { visibility: 'PRIVATE' },
  after: { visibility: 'PUBLIC', publishedAt: occurredAt.toISOString() },
};
export const decision = {
  before: { status: 'SUBMITTED' },
  after: { status: 'APPROVED' },
};

type MappingCase = {
  readonly name: string;
  readonly targetType: string;
  readonly metadata: Prisma.JsonValue;
  readonly expectedTarget: Partial<AuditTarget>;
};
export const cases: readonly MappingCase[] = [
  {
    name: 'empty legacy metadata',
    targetType: 'ROLE_REQUEST',
    metadata: {},
    expectedTarget: { name: null, login: null },
  },
  {
    name: 'v1 access without target snapshot',
    targetType: 'USER',
    metadata: {
      schemaVersion: 1,
      eventKind: 'DIRECT_ROLE_CHANGED',
      actor: people.actor,
      before: state,
      after: state,
    },
    expectedTarget: { name: null, login: null },
  },
  {
    name: 'v2 access target snapshot',
    targetType: 'USER',
    metadata: {
      schemaVersion: 2,
      eventKind: 'DIRECT_ROLE_CHANGED',
      ...people,
      before: state,
      after: state,
    },
    expectedTarget: { name: 'Original target', login: 'old-target' },
  },
  {
    name: 'v2 program snapshot',
    targetType: 'PROGRAM',
    metadata: {
      schemaVersion: 2,
      programName: 'Original program',
      ...lifecycle,
    },
    expectedTarget: { name: 'Original program', programName: null },
  },
  {
    name: 'v1 program join',
    targetType: 'PROGRAM',
    metadata: { schemaVersion: 1, ...lifecycle },
    expectedTarget: { name: 'Current program' },
  },
  {
    name: 'v2 repository snapshot',
    targetType: 'REPOSITORY',
    metadata: {
      schemaVersion: 2,
      repositoryId: 'target',
      repositoryFullName: 'original/repo',
      ...visibility,
    },
    expectedTarget: { name: 'original/repo' },
  },
  {
    name: 'v1 repository join',
    targetType: 'REPOSITORY',
    metadata: { schemaVersion: 1, repositoryId: 'target', ...visibility },
    expectedTarget: { name: 'current/repo' },
  },
  {
    name: 'v2 application snapshot parts',
    targetType: 'APPLICATION',
    metadata: {
      schemaVersion: 2,
      programName: 'Original program',
      applicantGithubLogin: 'original-applicant',
      ...decision,
    },
    expectedTarget: {
      name: null,
      login: 'original-applicant',
      programName: 'Original program',
    },
  },
  {
    name: 'v1 application joined program',
    targetType: 'APPLICATION',
    metadata: { schemaVersion: 1, ...decision },
    expectedTarget: {
      name: null,
      login: null,
      programName: 'Current application program',
    },
  },
  {
    name: 'team parts without composition',
    targetType: 'TEAM',
    metadata: {
      schemaVersion: 1,
      programName: 'Original program',
      teamName: 'Original team',
    },
    expectedTarget: {
      name: 'Original team',
      programName: 'Original program',
      teamName: null,
    },
  },
  {
    name: 'program without team',
    targetType: 'PROGRAM',
    metadata: { schemaVersion: 1, programName: 'Original program' },
    expectedTarget: { name: 'Original program', teamName: null },
  },
];

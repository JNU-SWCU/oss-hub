import type { Prisma } from '@prisma/client';

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
  readonly expectedTarget: string;
};
export const cases: readonly MappingCase[] = [
  {
    name: 'empty legacy metadata',
    targetType: 'ROLE_REQUEST',
    metadata: {},
    expectedTarget: 'ROLE_REQUEST / target',
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
    expectedTarget: 'USER / target',
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
    expectedTarget: 'Original target',
  },
  {
    name: 'v2 program snapshot',
    targetType: 'PROGRAM',
    metadata: {
      schemaVersion: 2,
      programName: 'Original program',
      ...lifecycle,
    },
    expectedTarget: 'Original program',
  },
  {
    name: 'v1 program join',
    targetType: 'PROGRAM',
    metadata: { schemaVersion: 1, ...lifecycle },
    expectedTarget: 'Current program',
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
    expectedTarget: 'original/repo',
  },
  {
    name: 'v1 repository join',
    targetType: 'REPOSITORY',
    metadata: { schemaVersion: 1, repositoryId: 'target', ...visibility },
    expectedTarget: 'current/repo',
  },
  {
    name: 'v2 application snapshot composition',
    targetType: 'APPLICATION',
    metadata: {
      schemaVersion: 2,
      programName: 'Original program',
      applicantGithubLogin: 'original-applicant',
      ...decision,
    },
    expectedTarget: 'Original program · @original-applicant',
  },
  {
    name: 'v1 application join without applicant leak',
    targetType: 'APPLICATION',
    metadata: { schemaVersion: 1, ...decision },
    expectedTarget: 'Current application program',
  },
  {
    name: 'team composition before program name',
    targetType: 'TEAM',
    metadata: {
      schemaVersion: 1,
      programName: 'Original program',
      teamName: 'Original team',
    },
    expectedTarget: 'Original program · Original team',
  },
  {
    name: 'program without team composition',
    targetType: 'PROGRAM',
    metadata: { schemaVersion: 1, programName: 'Original program' },
    expectedTarget: 'Original program',
  },
];

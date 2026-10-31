import {
  AdminAccessFacetsResponseDto,
  AdminAccessMutationResponseDto,
  AdminAccessUserPageResponseDto,
  AdminAccessUserResponseDto,
  AdminProfileUpdateResponseDto,
  IndependentAuthorityMutationResponseDto,
} from '../../src/admin/dto/admin-access-user-page-response.dto';
import { CollectionTriggerResponseDto } from '../../src/admin/dto/collection-trigger-response.dto';
import { SystemStatusResponseDto } from '../../src/admin/dto/system-status-response.dto';
import { AuditLogPageResponseDto } from '../../src/admin/dto/audit-log-page-response.dto';
import { type SystemStatusResult } from '../../src/admin/system-status.service';
import {
  type AdminAccessFacets,
  type AdminAccessUser,
} from '../../src/users/admin-access-read-ordering.repository';
import { type AdminAccessMutationResult } from '../../src/users/admin-access-mutation.service';

const at = (iso: string): Date => new Date(iso);

const facets: AdminAccessFacets = {
  roles: { unassigned: 1, student: 2, staff: 3, admin: 4 },
  accountStatuses: { active: 9, deactivated: 1 },
  pendingRequests: { none: 8, pending: 2 },
};

const userWithPending: AdminAccessUser = {
  id: 'user-1',
  githubLogin: 'octo',
  name: 'Octo Cat',
  role: 'STUDENT',
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: false,
  accountStatus: 'ACTIVE',
  isSelf: false,
  isProfileComplete: true,
  createdAt: at('2026-01-02T03:04:05.000Z'),
  pendingRequest: {
    id: 'request-1',
    status: 'PENDING',
    createdAt: at('2026-02-03T04:05:06.000Z'),
  },
  lastLoginAt: at('2026-03-04T05:06:07.000Z'),
};

const userWithoutPending: AdminAccessUser = {
  ...userWithPending,
  id: 'user-2',
  name: null,
  role: null,
  isSelf: true,
  pendingRequest: null,
  lastLoginAt: null,
};

const mutation: AdminAccessMutationResult = {
  id: 'user-1',
  role: 'STAFF',
  accountStatus: 'ACTIVE',
  pendingRequest: null,
  decidedRequest: {
    id: 'request-1',
    status: 'APPROVED',
  },
};

const systemStatus: SystemStatusResult = {
  collection: {
    health: 'DELAYED',
    dataAsOf: at('2026-05-01T00:00:00.000Z'),
    trackedRepositoryCount: 12,
    readyStreamCount: 30,
    backfillingStreamCount: 4,
    partialStreamCount: 2,
    retryPendingStreamCount: 1,
    oldestReadyCheckpointAt: at('2026-04-30T00:00:00.000Z'),
    oldestRetryPendingAt: null,
    lastCycleStartedAt: at('2026-05-01T01:00:00.000Z'),
    lastCycleCompletedAt: null,
    nextCycleAt: at('2026-05-01T02:00:00.000Z'),
    currentRunStatus: 'PROCESSING',
    safeReason: 'RUN_INCOMPLETE',
  },
  repositoryProvisioning: { finalFailureCount: 3 },
  collectionStreams: [
    {
      repositoryName: 'org/repo',
      programName: 'Program A',
      streams: [
        {
          streamType: 'COMMIT',
          bucket: 'READY',
          lastSuccessAt: at('2026-05-01T00:30:00.000Z'),
          lastErrorCode: null,
          lastErrorAt: null,
        },
        {
          streamType: 'ISSUE',
          bucket: 'RETRY_PENDING',
          lastSuccessAt: null,
          lastErrorCode: 'RATE_LIMIT',
          lastErrorAt: at('2026-05-01T00:40:00.000Z'),
        },
      ],
    },
  ],
  collectionActivity: [
    {
      sweepFinishedAt: at('2026-05-01T00:50:00.000Z'),
      cycleStartedAt: null,
      scope: 'all',
      kind: 'SWEEP',
      insertedCommitCount: 5,
      insertedPullRequestCount: 6,
      insertedReleaseCount: 7,
      insertedIssueCount: 8,
      attemptedRepositoryCount: 9,
      processedRepositoryCount: 8,
      failedRepositoryCount: 1,
      cycleCompleted: false,
      stoppedForBudget: true,
    },
  ],
  externalCollection: {
    trackedRepositoryCount: 12,
    lastSweep: {
      sweepFinishedAt: at('2026-05-01T00:55:00.000Z'),
      cycleStartedAt: at('2026-05-01T00:10:00.000Z'),
      scope: 'repository:1',
      kind: 'REPOSITORY_LINK',
      insertedCommitCount: 1,
      insertedPullRequestCount: 2,
      insertedReleaseCount: 3,
      insertedIssueCount: 4,
      attemptedRepositoryCount: 1,
      processedRepositoryCount: 1,
      failedRepositoryCount: 0,
      cycleCompleted: true,
      stoppedForBudget: false,
    },
    cumulativeCommitCount: 100,
    cumulativePullRequestCount: 200,
    cumulativeReleaseCount: 300,
    cumulativeIssueCount: 400,
  },
};

const cases: ReadonlyArray<readonly [string, () => unknown]> = [
  [
    'AdminAccessUserResponseDto pending',
    () => AdminAccessUserResponseDto.from(userWithPending),
  ],
  [
    'AdminAccessUserResponseDto no pending',
    () => AdminAccessUserResponseDto.from(userWithoutPending),
  ],
  [
    'AdminAccessFacetsResponseDto',
    () => AdminAccessFacetsResponseDto.from(facets),
  ],
  [
    'AdminAccessUserPageResponseDto',
    () =>
      AdminAccessUserPageResponseDto.from({
        items: [userWithPending, userWithoutPending],
        page: 2,
        limit: 20,
        total: 41,
        facets,
      }),
  ],
  [
    'AdminAccessMutationResponseDto',
    () => AdminAccessMutationResponseDto.from(mutation),
  ],
  [
    'AdminAccessMutationResponseDto pending',
    () =>
      AdminAccessMutationResponseDto.from({
        ...mutation,
        pendingRequest: userWithPending.pendingRequest,
        decidedRequest: null,
      }),
  ],
  [
    'IndependentAuthorityMutationResponseDto',
    () =>
      IndependentAuthorityMutationResponseDto.from({
        id: 'user-1',
        role: 'ADMIN',
        memberKind: 'STAFF',
        hasStaffAccess: true,
        hasAdminAccess: true,
      }),
  ],
  [
    'AdminProfileUpdateResponseDto',
    () =>
      AdminProfileUpdateResponseDto.from({
        id: 'user-1',
        name: 'Name',
        studentId: '2026000001',
        department: null,
      }),
  ],
  [
    'CollectionTriggerResponseDto',
    () => CollectionTriggerResponseDto.from('run-1'),
  ],
  ['SystemStatusResponseDto', () => SystemStatusResponseDto.from(systemStatus)],
  [
    'SystemStatusResponseDto empty',
    () =>
      SystemStatusResponseDto.from({
        ...systemStatus,
        collection: {
          ...systemStatus.collection,
          health: 'EMPTY',
          dataAsOf: null,
          oldestReadyCheckpointAt: null,
          lastCycleStartedAt: null,
          nextCycleAt: null,
          currentRunStatus: 'IDLE',
          safeReason: null,
        },
        collectionStreams: [],
        collectionActivity: [],
        externalCollection: {
          ...systemStatus.externalCollection,
          lastSweep: null,
        },
      }),
  ],
  [
    'AuditLogPageResponseDto',
    () =>
      AuditLogPageResponseDto.from({
        items: [
          {
            id: 'audit-1',
            actor: 'Octo Cat',
            actorHandle: 'octo',
            action: 'COLLECTION_TRIGGERED',
            targetType: 'COLLECTION',
            targetId: 'run-1',
            target: 'run-1',
            targetHandle: null,
            occurredAt: at('2026-05-01T00:00:00.000Z'),
            legacy: false,
            metadata: { schemaVersion: 1 },
          },
          {
            id: 'audit-2',
            actor: 'octo',
            actorHandle: 'octo',
            action: 'LEGACY_ACTION',
            targetType: 'USER',
            targetId: 'user-1',
            target: 'user-1',
            targetHandle: null,
            occurredAt: at('2026-04-01T00:00:00.000Z'),
            legacy: true,
            metadata: null,
          },
        ],
        total: 2,
        page: 1,
        limit: 20,
      }),
  ],
];

describe('admin response DTO JSON', () => {
  it.each(cases)('%s', (_name, build) => {
    expect(JSON.stringify(build())).toMatchSnapshot();
  });
});

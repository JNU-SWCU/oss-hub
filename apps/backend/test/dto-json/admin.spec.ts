import {
  AdminAccessFacetsResponseDto,
  AdminAccessMutationResponseDto,
  AdminAccessUserPageResponseDto,
  AdminAccessUserResponseDto,
  AdminProfileUpdateResponseDto,
  IndependentAuthorityMutationResponseDto,
} from '../../src/admin/dto/admin-access-user-page-response.dto';
import { CollectionTriggerResponseDto } from '../../src/admin/dto/collection-trigger-response.dto';
import { ProvisioningRetryResponseDto } from '../../src/admin/dto/provisioning-retry-response.dto';
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
  approvalStatus: 'PENDING',
  approvalRequestId: 'request-1',
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
  approvalStatus: 'NOT_REQUIRED',
  approvalRequestId: null,
  name: null,
  role: null,
  isSelf: true,
  pendingRequest: null,
  lastLoginAt: null,
};

const mutation: AdminAccessMutationResult = {
  id: 'user-1',
  role: 'STAFF',
  approvalStatus: 'APPROVED',
  approvalRequestId: 'request-1',
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
    trackedRepositoryCount: 12,
    staleRepositoryCount: 1,
    lastSuccessAt: at('2026-05-01T00:45:00.000Z'),
    nextCycleAt: at('2026-05-01T02:00:00.000Z'),
    currentRunStatus: 'PROCESSING',
    safeReason: 'STALE_DATA',
  },
  provisioning: {
    pending: 2,
    processing: 1,
    retryable: 1,
    failedFinal: 1,
    failedTeams: [
      {
        teamId: 'team-1',
        teamName: 'Team A',
        programName: 'Program A',
        lastErrorCode: 'REPOSITORY_PROVISION_INTERNAL',
        updatedAt: at('2026-04-30T23:00:00.000Z'),
      },
    ],
  },
  mail: {
    sent7d: 5,
    failed7d: 1,
    lastSentAt: at('2026-04-30T22:00:00.000Z'),
  },
  anomalies: [
    {
      rule: 'BULK_REMOVAL',
      severity: 'HIGH',
      count: 12,
      target: { kind: 'USER', id: 'user-1' },
    },
    { rule: 'MAIL_FAILED', severity: 'MEDIUM', count: 1, target: null },
  ],
  collectionRepositories: [
    {
      repositoryName: 'org/repo',
      programName: 'Program A',
      lastSuccessAt: at('2026-05-01T00:30:00.000Z'),
      stale: false,
    },
    {
      repositoryName: 'org/late',
      programName: null,
      lastSuccessAt: at('2026-04-30T20:00:00.000Z'),
      stale: true,
    },
  ],
  externalCollection: {
    trackedRepositoryCount: 12,
    lastSuccessAt: at('2026-05-01T00:55:00.000Z'),
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
        approvalStatus: 'PENDING',
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
        approvalStatus: 'APPROVED',
        approvalRequestId: null,
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
  [
    'ProvisioningRetryResponseDto',
    () => ProvisioningRetryResponseDto.from('team-1', { eventId: 'event-2' }),
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
          trackedRepositoryCount: 0,
          staleRepositoryCount: 0,
          lastSuccessAt: null,
          nextCycleAt: null,
          currentRunStatus: 'IDLE',
          safeReason: 'NO_TRACKED_REPOSITORIES',
        },
        collectionRepositories: [],
        externalCollection: {
          ...systemStatus.externalCollection,
          lastSuccessAt: null,
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
            occurredAt: at('2026-05-01T00:00:00.000Z'),
            action: 'COLLECTION_TRIGGERED',
            category: 'OPERATION',
            actor: {
              id: 'user-0',
              name: 'Octo Cat',
              login: 'octo',
              role: 'ADMIN',
            },
            target: {
              type: 'COLLECTION',
              id: 'run-1',
              name: null,
              login: null,
              role: null,
              programName: null,
              teamName: null,
            },
            change: { field: 'visibility', before: 'PRIVATE', after: 'PUBLIC' },
            requestId: null,
            teamMembership: null,
            legacy: false,
            metadata: { schemaVersion: 1 },
          },
          {
            id: 'audit-2',
            occurredAt: at('2026-04-01T00:00:00.000Z'),
            action: 'LEGACY_ACTION',
            category: 'SYSTEM',
            actor: null,
            target: {
              type: 'USER',
              id: 'user-1',
              name: 'Octo Target',
              login: 'octo-target',
              role: 'STUDENT',
              programName: null,
              teamName: null,
            },
            change: null,
            requestId: 'request-1',
            teamMembership: {
              operation: 'LEAVE',
              leaderChanged: false,
              teamDeleted: false,
            },
            legacy: true,
            metadata: null,
          },
        ],
        total: 2,
        page: 1,
        limit: 20,
        counts: {
          ACCOUNT: 0,
          OPERATION: 1,
          SUBMISSION: 0,
          LOGIN: 0,
          SYSTEM: 1,
        },
      }),
  ],
];

describe('admin response DTO JSON', () => {
  it.each(cases)('%s', (_name, build) => {
    expect(JSON.stringify(build())).toMatchSnapshot();
  });
});

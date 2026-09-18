import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import {
  getRepositoryHistory,
  parseStaffRepositoryEvidence,
  StaffRepositoryResponseError,
  type StaffRepositoryEvidence,
} from './staff-repository-evidence';

vi.mock('@/lib/api-client', () => ({ apiClient: vi.fn() }));

describe('staff repository evidence boundary', () => {
  const evidence: StaffRepositoryEvidence = {
    repositoryContributions: {
      repositoryId: 'repo-1',
      repositoryUrl: 'https://github.com/synthetic/current',
      window: { from: '2026-01-01', to: '2026-12-31', timeZone: 'Asia/Seoul' },
      collectionStatus: 'COLLECTED',
      lastSuccessAt: '2026-09-01T00:00:00.000Z',
      members: [
        {
          userId: 'user-1',
          githubId: '101',
          commitCount: 2,
          pullRequestCount: 3,
          releaseCount: 1,
          hasObservations: true,
        },
      ],
      unmatchedContributors: [
        {
          githubId: '999',
          commitCount: 7,
          pullRequestCount: 0,
          releaseCount: 0,
        },
      ],
    },
    repositoryUrlHistory: {
      items: [
        {
          id: 'audit-1',
          occurredAt: '2026-09-01T00:00:00.000Z',
          actorGithubLogin: 'synthetic-author',
          previousRepositoryUrl: null,
          newRepositoryUrl: 'https://github.com/synthetic/current',
          reason: 'Project moved',
        },
      ],
      nextCursor: 'opaque-cursor',
    },
  };
  it('preserves member identities, unmatched counts and immutable history', () => {
    // Given / When
    const parsed = parseStaffRepositoryEvidence(evidence);
    // Then
    expect(parsed).toEqual(evidence);
  });
  it('accepts the legacy program window extended ISO year without truncation', () => {
    const legacyEvidence = {
      ...evidence,
      repositoryContributions: {
        ...evidence.repositoryContributions,
        window: {
          from: '0001-01-01',
          to: '+010000-01-01',
          timeZone: 'Asia/Seoul',
        },
      },
    };
    expect(parseStaffRepositoryEvidence(legacyEvidence)).toEqual(
      legacyEvidence,
    );
  });
  it.each([
    {},
    { repositoryContributions: null, repositoryUrlHistory: [] },
    {
      ...evidence,
      repositoryContributions: {
        ...evidence.repositoryContributions,
        members: [
          {
            userId: 'user-1',
            githubId: '101',
            commitCount: -1,
            pullRequestCount: 0,
            releaseCount: 0,
            hasObservations: true,
          },
        ],
      },
    },
    {
      ...evidence,
      repositoryContributions: {
        ...evidence.repositoryContributions,
        collectionStatus: 'UNKNOWN',
      },
    },
    {
      ...evidence,
      repositoryContributions: {
        ...evidence.repositoryContributions,
        repositoryUrl: 'javascript:alert(1)',
      },
    },
    {
      ...evidence,
      repositoryContributions: {
        ...evidence.repositoryContributions,
        lastSuccessAt: 'not-a-date',
      },
    },
    {
      ...evidence,
      repositoryContributions: {
        ...evidence.repositoryContributions,
        window: {
          from: 'not-a-date',
          to: '2026-12-31',
          timeZone: 'Asia/Seoul',
        },
      },
    },
    {
      ...evidence,
      repositoryUrlHistory: {
        items: [
          {
            ...evidence.repositoryUrlHistory.items[0],
            newRepositoryUrl: 'https://example.com/untrusted',
          },
        ],
        nextCursor: null,
      },
    },
  ])('rejects incomplete or invalid evidence %j', (value) => {
    // Given / When / Then
    expect(() => parseStaffRepositoryEvidence(value)).toThrow(
      StaffRepositoryResponseError,
    );
  });
  it('encodes the opaque history cursor without changing it', async () => {
    // Given
    vi.mocked(apiClient).mockResolvedValue(evidence.repositoryUrlHistory);
    // When
    const page = await getRepositoryHistory('program/1', 'team/1', 'cursor+=/');
    // Then
    expect(apiClient).toHaveBeenCalledWith(
      'programs/program%2F1/teams/team%2F1/repository-url-history?cursor=cursor%2B%3D%2F',
    );
    expect(page.nextCursor).toBe('opaque-cursor');
  });
});

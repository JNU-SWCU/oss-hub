import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { createApplication } from './api';
import {
  parseRepositoryUrlState,
  RepositoryUrlResponseError,
  updateRepositoryUrl,
} from './repository-url-api';

vi.mock('@/lib/api-client', () => ({ apiClient: vi.fn() }));

describe('repository URL contracts', () => {
  it.each(['\n', '\r', '\r\n'])(
    'trims URL whitespace %j and sends no change reason',
    async (ending) => {
      // Given
      const response = {
        repositoryUrl: 'https://github.com/synthetic/repo',
        canEditRepositoryUrl: true,
      };
      vi.mocked(apiClient).mockResolvedValue(response);
      // When
      await updateRepositoryUrl('program/1', {
        repositoryUrl: `${ending} https://github.com/synthetic/repo ${ending}`,
      });
      // Then
      expect(apiClient).toHaveBeenLastCalledWith(
        'programs/program%2F1/applications/me/repository-url',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repositoryUrl: response.repositoryUrl,
          }),
        },
      );
    },
  );
  it.each([
    null,
    {},
    { repositoryUrl: null },
    { repositoryUrl: 42, canEditRepositoryUrl: true },
  ])('rejects malformed repository state %j', (value) => {
    // Given / When / Then
    expect(() => parseRepositoryUrlState(value)).toThrow(
      RepositoryUrlResponseError,
    );
  });
  it.each([
    null,
    'https://github.com/synthetic/repo',
    'https://github.com/synthetic/repo/',
  ] as const)('accepts repositoryUrl %j', (repositoryUrl) => {
    expect(
      parseRepositoryUrlState({
        repositoryUrl,
        canEditRepositoryUrl: true,
      }),
    ).toEqual({ repositoryUrl, canEditRepositoryUrl: true });
  });
  it.each([
    'javascript:alert(1)',
    'https://example.com/untrusted',
    'http://github.com/synthetic/repo',
    'https://github.com/synthetic/repo/issues',
    'https://github.com.evil.example/synthetic/repo',
  ])(
    'rejects unsafe repositoryUrl %j as a clickable href source',
    (repositoryUrl) => {
      expect(() =>
        parseRepositoryUrlState({
          repositoryUrl,
          canEditRepositoryUrl: true,
        }),
      ).toThrow(RepositoryUrlResponseError);
    },
  );
  it('omits repository selection when submitting a new application', async () => {
    // Given
    vi.mocked(apiClient).mockResolvedValue({});
    // When
    await createApplication('program-1', {
      answers: { title: 'Synthetic application' },
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
    });
    // Then
    expect(apiClient).toHaveBeenLastCalledWith(
      'programs/program-1/applications',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: { title: 'Synthetic application' },
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
        }),
      },
    );
  });
});

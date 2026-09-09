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
    'trims URL and reason while preserving %j line endings at the mutation boundary',
    async (ending) => {
      // Given
      const response = {
        repositoryUrl: 'https://github.com/synthetic/repo',
        canEditRepositoryUrl: true,
      };
      vi.mocked(apiClient).mockResolvedValue(response);
      // When
      await updateRepositoryUrl('program/1', {
        repositoryUrl: ' https://github.com/synthetic/repo ',
        reason: ` project moved${ending}Preserve project history `,
      });
      // Then
      expect(apiClient).toHaveBeenLastCalledWith(
        'programs/program%2F1/applications/me/repository-url',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repositoryUrl: response.repositoryUrl,
            reason: `project moved${ending}Preserve project history`,
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
  it('omits repository selection when submitting a new application', async () => {
    // Given
    vi.mocked(apiClient).mockResolvedValue({});
    // When
    await createApplication('program-1', {
      answers: { summary: 'Synthetic application' },
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
          answers: { summary: 'Synthetic application' },
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
        }),
      },
    );
  });
});

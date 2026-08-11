import { MODULE_METADATA } from '@nestjs/common/constants';
import type { GithubInstallationTokenProvider } from './github-app.token';
import { GithubAppClient } from './github-app.client';
import { REPOSITORIES_READ_PORT } from './repositories-read.port';
import {
  RepositoriesModule,
  resolveGithubAppClient,
} from './repositories.module';
import { RepositoriesService } from './service/repositories.service';
import { e2eProgramAuthoringExternalPorts } from '../e2e-program-authoring/e2e-external-ports';

const tokenProvider: GithubInstallationTokenProvider = {
  organization: 'incumbent-org',
  accessToken: () => Promise.resolve('token'),
  invalidateAccessToken: () => undefined,
};

const operationsConfig = {
  requireOrganization: () => 'e2e-org',
};

const getMetadataArray = (key: string): unknown[] => {
  const metadata = Reflect.getMetadata(key, RepositoriesModule) as unknown;
  expect(Array.isArray(metadata)).toBe(true);
  return Array.isArray(metadata) ? metadata : [];
};

describe('RepositoriesModule', () => {
  it('exports the DTO-only read port backed by RepositoriesService', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const exports = getMetadataArray(MODULE_METADATA.EXPORTS);

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: REPOSITORIES_READ_PORT,
          useExisting: RepositoriesService,
        }),
      ]),
    );
    expect(exports).toContain(REPOSITORIES_READ_PORT);
  });

  it.each(['development', 'test', 'production'] as const)(
    'keeps the incumbent client in %s without external test control',
    (nodeEnvironment) => {
      // Given
      e2eProgramAuthoringExternalPorts.reset();

      // When
      const client = resolveGithubAppClient(tokenProvider, operationsConfig, {
        NODE_ENV: nodeEnvironment,
      });

      // Then
      expect(client).toBeInstanceOf(GithubAppClient);
    },
  );

  it('selects the shared fake only for explicit test control', () => {
    // Given
    e2eProgramAuthoringExternalPorts.reset();

    // When
    const client = resolveGithubAppClient(tokenProvider, operationsConfig, {
      NODE_ENV: 'test',
      E2E_PROGRAM_AUTHORING_CONTROL: 'enabled',
    });

    // Then
    expect(client).toBe(e2eProgramAuthoringExternalPorts.github);
    expect(e2eProgramAuthoringExternalPorts.github.configuredOrganization).toBe(
      'e2e-org',
    );
  });

  it('fails closed when production enables external test control', () => {
    expect(() =>
      resolveGithubAppClient(tokenProvider, operationsConfig, {
        NODE_ENV: 'production',
        E2E_PROGRAM_AUTHORING_CONTROL: 'enabled',
      }),
    ).toThrow(/forbidden/);
  });
});

import { MODULE_METADATA } from '@nestjs/common/constants';
import { REPOSITORIES_READ_PORT } from './repositories-read.port';
import { RepositoriesModule } from './repositories.module';
import { RepositoriesService } from './repositories.service';

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
});

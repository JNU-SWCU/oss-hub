import { MODULE_METADATA } from '@nestjs/common/constants';
import { RepositoriesModule } from './repositories.module';
import { RepositoriesReadService } from './service/repositories-read.service';

const getMetadataArray = (key: string): unknown[] => {
  const metadata = Reflect.getMetadata(key, RepositoriesModule) as unknown;
  expect(Array.isArray(metadata)).toBe(true);
  return Array.isArray(metadata) ? metadata : [];
};

describe('RepositoriesModule', () => {
  it('exports the concrete read service without aliases', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const exports = getMetadataArray(MODULE_METADATA.EXPORTS);

    expect(providers).toContain(RepositoriesReadService);
    expect(exports).toContain(RepositoriesReadService);
    expect(
      providers.filter(
        (provider) =>
          typeof provider === 'object' &&
          provider !== null &&
          'useExisting' in provider,
      ),
    ).toEqual([]);
  });
});

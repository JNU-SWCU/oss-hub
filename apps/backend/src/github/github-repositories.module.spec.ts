import { MODULE_METADATA } from '@nestjs/common/constants';
import { GithubModule } from './github.module';
import { RepositoriesReadService } from './repositories-read.service';

const getMetadataArray = (key: string): unknown[] => {
  const metadata = Reflect.getMetadata(key, GithubModule) as unknown;
  expect(Array.isArray(metadata)).toBe(true);
  return Array.isArray(metadata) ? metadata : [];
};

describe('GithubModule', () => {
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

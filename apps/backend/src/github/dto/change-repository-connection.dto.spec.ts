import { RepositoryConnectionMode } from '@prisma/client';
import { validate } from 'class-validator';
import { ChangeRepositoryConnectionRequestDto } from './change-repository-connection.dto';

async function errors(input: object) {
  return validate(
    Object.assign(new ChangeRepositoryConnectionRequestDto(), input),
  );
}

describe('ChangeRepositoryConnectionRequestDto', () => {
  it('accepts NEW without a URL', async () => {
    await expect(
      errors({ mode: RepositoryConnectionMode.NEW }),
    ).resolves.toHaveLength(0);
  });

  it('rejects NEW with a URL', async () => {
    await expect(
      errors({
        mode: RepositoryConnectionMode.NEW,
        url: 'https://github.com/a/b',
      }),
    ).resolves.not.toHaveLength(0);
  });

  it.each([
    [{ mode: RepositoryConnectionMode.OWN }],
    [{ mode: RepositoryConnectionMode.OWN, url: 'https://gitlab.com/a/b' }],
    [{ mode: RepositoryConnectionMode.OWN, url: 'https://github.com/a' }],
  ])('requires an exact GitHub URL for OWN: %p', async (input) => {
    await expect(errors(input)).resolves.not.toHaveLength(0);
  });

  it('accepts an exact GitHub repository URL for OWN', async () => {
    await expect(
      errors({
        mode: RepositoryConnectionMode.OWN,
        url: 'https://github.com/synthetic-owner/synthetic-repository',
      }),
    ).resolves.toHaveLength(0);
  });
});

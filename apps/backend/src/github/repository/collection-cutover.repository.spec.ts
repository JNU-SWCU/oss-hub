import { CollectionCutoverRepository } from './collection-cutover.repository';
import type { PrismaService } from '../../prisma/prisma.service';

const createDb = () => ({ $queryRawUnsafe: jest.fn() });
const repositoryFor = (db: ReturnType<typeof createDb>) =>
  new CollectionCutoverRepository(db as unknown as PrismaService);

describe('CollectionCutoverRepository quiescence', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');

  it('isQuiesced는 살아있는 lease가 있으면 true를 반환한다', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValue([{ quiesced: true }]);

    await expect(repositoryFor(db).isQuiesced(now)).resolves.toBe(true);
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('SELECT EXISTS'),
      now,
    );
  });

  it('isQuiesced는 살아있는 lease가 없으면 false를 반환한다', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValue([{ quiesced: false }]);

    await expect(repositoryFor(db).isQuiesced(now)).resolves.toBe(false);
  });
});

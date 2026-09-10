import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgramCoverRepository } from './program-cover.repository';

it('restricts the public selector to current image metadata and the explicit public lifecycle allowlist', async () => {
  const findFirst = jest.fn().mockResolvedValue(null);
  const moduleRef = await Test.createTestingModule({
    providers: [
      ProgramCoverRepository,
      { provide: PrismaService, useValue: { programCover: { findFirst } } },
    ],
  }).compile();
  const repository = moduleRef.get(ProgramCoverRepository);
  await expect(
    repository.findPublicCover('program', 'cover'),
  ).resolves.toBeNull();
  expect(findFirst).toHaveBeenCalledWith({
    where: {
      id: 'cover',
      programId: 'program',
      program: { lifecycle: { in: ['PUBLISHED', 'ARCHIVED'] } },
      storageKey: { startsWith: 'program-covers/' },
      mimeType: { in: ['image/jpeg', 'image/png'] },
      sizeBytes: { gte: 1, lte: 5242880 },
    },
    select: { storageKey: true, mimeType: true, sizeBytes: true },
  });
});

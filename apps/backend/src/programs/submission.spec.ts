import type { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';
import { SubmissionsRepository } from './submissions.repository';

import { SubmissionPublicIdCollisionError } from './submissions.error';

describe('submission-public-id', () => {
  describe('submission public identity', () => {
    it('looks up the preserved public ID as the primary key', () => {
      expect(
        new SubmissionsRepository(
          {} as PrismaService,
          new PlatformRepository(),
        ).submissionPublicIdWhere('submission-id'),
      ).toEqual({
        id: 'submission-id',
      });
    });

    it('returns exactly zero or one row and fails closed on ambiguity', () => {
      expect(
        new SubmissionsRepository(
          {} as PrismaService,
          new PlatformRepository(),
        ).exactSubmissionByPublicId([]),
      ).toBeNull();
      expect(
        new SubmissionsRepository(
          {} as PrismaService,
          new PlatformRepository(),
        ).exactSubmissionByPublicId([{ id: 'only' }]),
      ).toEqual({
        id: 'only',
      });
      expect(() =>
        new SubmissionsRepository(
          {} as PrismaService,
          new PlatformRepository(),
        ).exactSubmissionByPublicId([{ id: 'a' }, { id: 'b' }]),
      ).toThrow(SubmissionPublicIdCollisionError);
    });
  });
});

import { SubmissionsRepository } from './submissions.repository';

import { SubmissionPublicIdCollisionError } from './submissions.error';

describe('submission-public-id', () => {
  describe('submission public identity', () => {
    it('builds the permanent dual-key predicate', () => {
      expect(
        SubmissionsRepository.submissionPublicIdWhere('submission-id'),
      ).toEqual({
        OR: [{ id: 'submission-id' }, { legacySubmissionId: 'submission-id' }],
      });
    });

    it('returns exactly zero or one row and fails closed on ambiguity', () => {
      expect(SubmissionsRepository.exactSubmissionByPublicId([])).toBeNull();
      expect(
        SubmissionsRepository.exactSubmissionByPublicId([{ id: 'only' }]),
      ).toEqual({
        id: 'only',
      });
      expect(() =>
        SubmissionsRepository.exactSubmissionByPublicId([
          { id: 'a' },
          { id: 'b' },
        ]),
      ).toThrow(SubmissionPublicIdCollisionError);
    });
  });
});

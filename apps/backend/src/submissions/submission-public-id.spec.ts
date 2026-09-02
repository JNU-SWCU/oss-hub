import {
  exactSubmissionByPublicId,
  publicSubmissionId,
  submissionPublicIdWhere,
  SubmissionPublicIdCollisionError,
} from './submission-public-id';

describe('submission public identity', () => {
  it('keeps migrated public ids and uses target ids for new rows', () => {
    expect(
      publicSubmissionId({
        id: 'target-header',
        legacySubmissionId: 'legacy-submission',
      }),
    ).toBe('legacy-submission');
    expect(
      publicSubmissionId({ id: 'target-header', legacySubmissionId: null }),
    ).toBe('target-header');
  });

  it('builds the permanent dual-key predicate', () => {
    expect(submissionPublicIdWhere('submission-id')).toEqual({
      OR: [{ id: 'submission-id' }, { legacySubmissionId: 'submission-id' }],
    });
  });

  it('returns exactly zero or one row and fails closed on ambiguity', () => {
    expect(exactSubmissionByPublicId([])).toBeNull();
    expect(exactSubmissionByPublicId([{ id: 'only' }])).toEqual({ id: 'only' });
    expect(() => exactSubmissionByPublicId([{ id: 'a' }, { id: 'b' }])).toThrow(
      SubmissionPublicIdCollisionError,
    );
  });
});

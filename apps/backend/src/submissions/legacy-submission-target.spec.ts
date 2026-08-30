import {
  LegacySubmissionPublicIdCollisionError,
  publicLegacySubmissionId,
  requiredLegacySubmissionPublicId,
} from './legacy-submission-target';

describe('legacy submission target identity', () => {
  it('keeps migrated public ids and uses target ids for new rows', () => {
    expect(
      publicLegacySubmissionId({
        id: 'target-header',
        legacySubmissionId: 'legacy-submission',
      }),
    ).toBe('legacy-submission');
    expect(
      publicLegacySubmissionId({
        id: 'target-header',
        legacySubmissionId: null,
      }),
    ).toBe('target-header');
  });

  it.each([undefined, null, '', ' leading', 'trailing '])(
    'rejects invalid opaque public id %p',
    (value) => {
      expect(() => requiredLegacySubmissionPublicId(value)).toThrow(TypeError);
    },
  );

  it('keeps collision failures typed', () => {
    expect(new LegacySubmissionPublicIdCollisionError('collision')).toEqual(
      expect.objectContaining({
        name: 'LegacySubmissionPublicIdCollisionError',
        message: 'collision',
      }),
    );
  });
});

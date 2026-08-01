import {
  isPublicEligible,
  type PublicEligibilityInput,
} from './public-eligibility';

const publishedAt = new Date('2026-07-15T00:00:00.000Z');

function input(
  overrides: Partial<PublicEligibilityInput> = {},
): PublicEligibilityInput {
  return {
    platformPublic: true,
    publishedAt,
    observation: null,
    ...overrides,
  };
}

describe('isPublicEligible', () => {
  describe('platform eligibility gate', () => {
    it('platform-private이면 complete PUBLIC/PRESENT 관측이 있어도 항상 비공개다', () => {
      const result = isPublicEligible(
        input({
          platformPublic: false,
          observation: {
            visibility: 'PUBLIC',
            presence: 'PRESENT',
            observedAt: new Date('2026-07-16T00:00:00.000Z'),
          },
        }),
      );

      expect(result).toBe(false);
    });

    it('publishedAt이 없으면(managed publish 미확정) 항상 비공개다', () => {
      const result = isPublicEligible(input({ publishedAt: null }));

      expect(result).toBe(false);
    });
  });

  describe('unknown/partial observation', () => {
    it('관측 자체가 없으면(observation null) missing을 주장하지 않는다 — 공개 유지', () => {
      const result = isPublicEligible(input({ observation: null }));

      expect(result).toBe(true);
    });

    it('complete 관측이 한 번도 없으면(observedAt null) missing을 주장하지 않는다 — 공개 유지', () => {
      const result = isPublicEligible(
        input({
          observation: {
            visibility: 'PRIVATE',
            presence: 'ABSENT',
            observedAt: null,
          },
        }),
      );

      expect(result).toBe(true);
    });
  });

  describe('timestamp boundary — observedAt vs publishedAt', () => {
    it('complete private 관측이 publishedAt "이후"(>)면 회수한다(비공개)', () => {
      const result = isPublicEligible(
        input({
          observation: {
            visibility: 'PRIVATE',
            presence: 'PRESENT',
            observedAt: new Date(publishedAt.getTime() + 1),
          },
        }),
      );

      expect(result).toBe(false);
    });

    it('complete missing(ABSENT) 관측이 publishedAt "이후"(>)면 회수한다(비공개)', () => {
      const result = isPublicEligible(
        input({
          observation: {
            visibility: 'PUBLIC',
            presence: 'ABSENT',
            observedAt: new Date(publishedAt.getTime() + 1),
          },
        }),
      );

      expect(result).toBe(false);
    });

    it('complete private 관측이 publishedAt과 정확히 동시(=)면 stale이다 — 비공개로 만들지 않는다', () => {
      const result = isPublicEligible(
        input({
          observation: {
            visibility: 'PRIVATE',
            presence: 'PRESENT',
            observedAt: new Date(publishedAt.getTime()),
          },
        }),
      );

      expect(result).toBe(true);
    });

    it('complete private 관측이 publishedAt "이전"(<)이면 stale이다 — 비공개로 만들지 않는다', () => {
      const result = isPublicEligible(
        input({
          observation: {
            visibility: 'PRIVATE',
            presence: 'PRESENT',
            observedAt: new Date(publishedAt.getTime() - 1),
          },
        }),
      );

      expect(result).toBe(true);
    });
  });

  describe('complete PUBLIC/PRESENT observation', () => {
    it('publishedAt 이후 complete 관측이 PUBLIC/PRESENT면 공개 유지한다', () => {
      const result = isPublicEligible(
        input({
          observation: {
            visibility: 'PUBLIC',
            presence: 'PRESENT',
            observedAt: new Date(publishedAt.getTime() + 1),
          },
        }),
      );

      expect(result).toBe(true);
    });
  });
});

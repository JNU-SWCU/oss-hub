import { describe, expect, it } from 'vitest';
import {
  parseRequirementCollectionSearchParams,
  buildRequirementCollectionSearchParams,
} from './requirement-collection-url-state';

describe('RequirementCollection URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&sort=bad&status=bad&filter=bad&year=bad&granularity=bad&from=bad&to=bad&action=bad',
    );
    expect(parseRequirementCollectionSearchParams(input)).toEqual({
      page: 1,
      pageSize: 20,
      filter: 'ALL',
    });
  });

  it('omits defaults from the address', () => {
    expect(
      buildRequirementCollectionSearchParams({
        page: 1,
        pageSize: 20,
        filter: 'ALL',
      }).toString(),
    ).toBe('');
  });

  it('round trips nondefault shareable state', () => {
    const input = {
      page: 2,
      pageSize: 20,
      filter: 'LATE',
      document: { id: 'doc/1', submissionState: 'MISSING' },
    } as const;
    const params = buildRequirementCollectionSearchParams(input);
    expect(params.toString()).toBe(
      'filter=LATE&documentId=doc%2F1&submissionState=MISSING&page=2',
    );
    expect(parseRequirementCollectionSearchParams(params)).toEqual(input);
  });
});

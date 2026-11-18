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
      q: '',
      page: 1,
      pageSize: 20,
      filter: 'ALL',
    });
  });

  it('omits defaults from the address', () => {
    expect(
      buildRequirementCollectionSearchParams({
        q: '',
        page: 1,
        pageSize: 20,
        filter: 'ALL',
      }).toString(),
    ).toBe('');
  });

  it('round trips nondefault shareable state', () => {
    const input = {
      q: '',
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

  it('팀 검색어를 실어 나르고, 검색 중에는 한 번에 더 많은 팀을 불러온다', () => {
    const input = {
      q: 'hong',
      page: 1,
      pageSize: 100,
      filter: 'ALL',
    } as const;
    const params = buildRequirementCollectionSearchParams(input);
    expect(params.toString()).toBe('q=hong');
    expect(parseRequirementCollectionSearchParams(params)).toEqual(input);
  });
});

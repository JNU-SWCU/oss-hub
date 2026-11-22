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
      status: undefined,
      sort: 'team',
      direction: 'asc',
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
      filter: 'ALL',
      status: 'APPROVED',
      sort: 'reviewedAt',
      direction: 'desc',
    } as const;
    const params = buildRequirementCollectionSearchParams(input);
    expect(params.toString()).toBe(
      'status=APPROVED&sort=reviewedAt&direction=desc&page=2',
    );
    expect(parseRequirementCollectionSearchParams(params)).toEqual(input);
  });

  it('trims search without enlarging the server page or applying legacy filters', () => {
    const input = parseRequirementCollectionSearchParams(
      new URLSearchParams(
        'q=+hong+&filter=LATE&documentId=old&submissionState=MISSING',
      ),
    );
    expect(input).toMatchObject({ q: 'hong', pageSize: 20, filter: 'ALL' });
    expect(buildRequirementCollectionSearchParams(input).toString()).toBe(
      'q=hong',
    );
  });
});

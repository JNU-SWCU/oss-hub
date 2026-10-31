import { describe, expect, it } from 'vitest';
import {
  parseMilestoneDocumentCollectionSearchParams,
  buildMilestoneDocumentCollectionSearchParams,
} from './milestone-document-collection-url-state';

describe('MilestoneDocumentCollection URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&sort=bad&status=bad&filter=bad&year=bad&granularity=bad&from=bad&to=bad&action=bad',
    );
    expect(parseMilestoneDocumentCollectionSearchParams(input)).toEqual({
      page: 1,
      pageSize: 20,
      filter: 'ALL',
    });
  });

  it('omits defaults from the address', () => {
    expect(
      buildMilestoneDocumentCollectionSearchParams({
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
    const params = buildMilestoneDocumentCollectionSearchParams(input);
    expect(params.toString()).toBe(
      'filter=LATE&documentId=doc%2F1&submissionState=MISSING&page=2',
    );
    expect(parseMilestoneDocumentCollectionSearchParams(params)).toEqual(input);
  });
});

import { describe, expect, it } from 'vitest';
import { programDocumentArchivePath } from './program-document-archive-api';

describe('program archive scope', () => {
  it('keeps the program scope independent of list filters and encodes its identity', () => {
    expect(
      programDocumentArchivePath(
        'program:a/b',
        { kind: 'PROGRAM' },
        'DOCUMENT',
      ),
    ).toBe(
      'programs/program%3Aa%2Fb/documents/collection/archive?scope=PROGRAM&groupBy=DOCUMENT',
    );
  });
  it('sends only the selected milestone or team, with explicit grouping', () => {
    expect(
      programDocumentArchivePath(
        'program',
        { kind: 'MILESTONE', milestoneId: 'stage:1' },
        'TEAM',
      ),
    ).toBe(
      'programs/program/documents/collection/archive?scope=MILESTONE&groupBy=TEAM&milestoneId=stage%3A1',
    );
    expect(
      programDocumentArchivePath(
        'program',
        { kind: 'TEAM', teamId: 'team&1' },
        'DOCUMENT',
      ),
    ).toBe(
      'programs/program/documents/collection/archive?scope=TEAM&groupBy=DOCUMENT&teamId=team%261',
    );
  });
});

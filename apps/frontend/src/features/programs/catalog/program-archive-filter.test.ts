import { describe, expect, it } from 'vitest';
import {
  archiveListHref,
  parseProgramArchiveFilter,
} from './program-archive-filter';

describe('program archive year filter', () => {
  it('전체 및 연도 링크를 만든다', () => {
    expect(archiveListHref('all')).toBe('/archive');
    expect(archiveListHref(2026)).toBe('/archive?year=2026');
  });

  it.each([null, '', 'UNKNOWN', '1999', '2101', '2026.5'])(
    '잘못된 연도 %s는 전체로 해석한다',
    (value) => expect(parseProgramArchiveFilter(value)).toBe('all'),
  );

  it.each(['2000', '2026', '2100'])('허용된 연도 %s를 해석한다', (value) => {
    expect(parseProgramArchiveFilter(value)).toBe(Number(value));
  });
});

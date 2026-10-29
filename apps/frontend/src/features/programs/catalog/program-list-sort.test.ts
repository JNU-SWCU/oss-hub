import { describe, expect, it } from 'vitest';
import {
  buildProgramListHref,
  parseProgramListDirection,
  parseProgramListSort,
} from './program-list-sort';

describe('parseProgramListSort', () => {
  it('accepts known sort keys', () => {
    expect(parseProgramListSort('name')).toBe('name');
    expect(parseProgramListSort('applicationPeriod')).toBe('applicationPeriod');
    expect(parseProgramListSort('status')).toBe('status');
  });

  it('falls back to undefined for null or unknown values', () => {
    expect(parseProgramListSort(null)).toBeUndefined();
    expect(parseProgramListSort('')).toBeUndefined();
    expect(parseProgramListSort('bogus')).toBeUndefined();
  });
});

describe('parseProgramListDirection', () => {
  it('accepts asc/desc', () => {
    expect(parseProgramListDirection('asc')).toBe('asc');
    expect(parseProgramListDirection('desc')).toBe('desc');
  });

  it('falls back to undefined for null or unknown values', () => {
    expect(parseProgramListDirection(null)).toBeUndefined();
    expect(parseProgramListDirection('sideways')).toBeUndefined();
  });
});

describe('buildProgramListHref', () => {
  it('omits every param at the all-status/no-sort default', () => {
    expect(buildProgramListHref({ status: 'all' })).toBe('/programs');
  });

  it('keeps only the status when no sort is set', () => {
    expect(buildProgramListHref({ status: 'recruiting' })).toBe(
      '/programs?status=recruiting',
    );
  });

  it('adds sort but omits direction when direction is the asc default', () => {
    expect(
      buildProgramListHref({ status: 'all', sort: 'name', direction: 'asc' }),
    ).toBe('/programs?sort=name');
  });

  it('includes direction when it is desc', () => {
    expect(
      buildProgramListHref({
        status: 'all',
        sort: 'name',
        direction: 'desc',
      }),
    ).toBe('/programs?sort=name&direction=desc');
  });

  it('drops a stray direction when sort is absent', () => {
    expect(buildProgramListHref({ status: 'all', direction: 'desc' })).toBe(
      '/programs',
    );
  });

  it('combines status filter and sort together', () => {
    expect(
      buildProgramListHref({
        status: 'recruiting',
        sort: 'applicationPeriod',
        direction: 'desc',
      }),
    ).toBe('/programs?status=recruiting&sort=applicationPeriod&direction=desc');
  });
});

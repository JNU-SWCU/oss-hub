import { describe, expect, it } from 'vitest';
import {
  parseLandingStatsCounts,
  parseLandingProgramNamePage,
  parseLandingProgramPage,
} from './landing-overview';

describe('landing public overview boundary', () => {
  it('parses recruiting programs without private fields', () => {
    const page = parseLandingProgramPage({
      items: [
        {
          id: 'program_public_01',
          name: '공개 OSS 기여 프로그램',
          organizers: ['JNU-SWCU'],
          trackType: 'EXTRACURRICULAR',
          applicationStartAt: '2026-07-01T00:00:00.000Z',
          applicationEndAt: '2026-08-14T00:00:00.000Z',
          description: '공개 모집 정보',
          privateMemo: 'must-not-leak',
        },
      ],
      page: 1,
      pageSize: 3,
      totalItems: 1,
      totalPages: 1,
    });

    expect(page).toEqual([
      {
        id: 'program_public_01',
        name: '공개 OSS 기여 프로그램',
        organizers: ['JNU-SWCU'],
        trackType: 'EXTRACURRICULAR',
        applicationEndAt: '2026-08-14T00:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(page)).not.toContain('privateMemo');
  });

  it('rejects leftover category keys in program list responses', () => {
    expect(() =>
      parseLandingProgramPage({
        items: [
          {
            id: 'program_public_01',
            name: '공개 OSS 기여 프로그램',
            organizers: ['JNU-SWCU'],
            category: 'OSS_CONTEST',
            applicationEndAt: '2026-08-14T00:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: 3,
        totalItems: 1,
        totalPages: 1,
      }),
    ).toThrow('랜딩 공개 응답 형식이 올바르지 않습니다');
  });

  it('rejects a program whose organizers list is empty', () => {
    expect(() =>
      parseLandingProgramPage({
        items: [
          {
            id: 'program_public_01',
            name: '공개 OSS 기여 프로그램',
            organizers: [],
            trackType: null,
            applicationEndAt: '2026-08-14T00:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: 3,
        totalItems: 1,
        totalPages: 1,
      }),
    ).toThrow('랜딩 공개 응답 형식이 올바르지 않습니다');
  });

  it('accepts seed-style program ids that use colons', () => {
    const page = parseLandingProgramPage({
      items: [
        {
          id: 'seed:intake:program-seven-templates:BASIC',
          name: 'seed-program-basic',
          organizers: ['seed-organizer'],
          trackType: 'EXTRACURRICULAR',
          applicationEndAt: '2026-08-24T06:25:11.317Z',
        },
      ],
      page: 1,
      pageSize: 3,
      totalItems: 1,
      totalPages: 1,
    });

    expect(page[0]?.id).toBe('seed:intake:program-seven-templates:BASIC');
  });

  it('parses program names for the constellation and drops every other field', () => {
    const names = parseLandingProgramNamePage({
      items: [
        {
          id: 'seed:intake:program-seven-templates:BASIC',
          name: 'seed-program-basic',
          organizers: ['seed-organizer'],
          description: '시드 fixture 설명',
        },
      ],
      page: 1,
      pageSize: 6,
      totalItems: 1,
      totalPages: 1,
    });

    expect(names).toEqual([
      {
        id: 'seed:intake:program-seven-templates:BASIC',
        name: 'seed-program-basic',
      },
    ]);
  });

  it('rejects a program name page whose item has no usable name', () => {
    expect(() =>
      parseLandingProgramNamePage({
        items: [{ id: 'program_public_01', name: '   ' }],
      }),
    ).toThrow('랜딩 공개 응답 형식이 올바르지 않습니다');
  });

  it.each([
    { programCount: 4 },
    { repositoryCount: -1 },
    { contributorCount: 7 },
    { repositoryCount: 1.5 },
    { contributorCount: '2' },
    { contributorCount: undefined },
  ])('rejects invalid sampled counts %o', (override) => {
    expect(() =>
      parseLandingStatsCounts({
        programCount: 2,
        repositoryCount: 3,
        contributorCount: 2,
        ...override,
      }),
    ).toThrow('랜딩 공개 응답 형식이 올바르지 않습니다');
  });
});

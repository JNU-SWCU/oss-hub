import { ApplicationStatus, ProgramLifecycle } from '@prisma/client';
import type { PersonalizedProgramListItem } from '../service/programs.service';
import {
  ProgramListPageResponseDto,
  ProgramListResponseDto,
} from './program-list-response.dto';

function baseItem(
  overrides: Partial<PersonalizedProgramListItem> = {},
): PersonalizedProgramListItem {
  return {
    id: 'program-1',
    name: '프로그램',
    organizer: '운영기관',
    category: 'CAPSTONE',
    lifecycle: ProgramLifecycle.PUBLISHED,
    applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
    applicationEndAt: new Date('2026-08-01T00:00:00.000Z'),
    endAt: new Date('2026-12-31T00:00:00.000Z'),
    description: '설명',
    teamMinSize: 1,
    teamMaxSize: 1,
    ...overrides,
  };
}

describe('ProgramListResponseDto', () => {
  it('개인화 필드가 없으면 JSON 직렬화에서 완전히 생략된다(undefined, null 아님)', () => {
    const dto = ProgramListResponseDto.from(baseItem());

    const json = JSON.parse(JSON.stringify(dto)) as Record<string, unknown>;

    expect(json.note).toBeUndefined();
    expect(json.viewerApplicationStatus).toBeUndefined();
    expect(json.applicationCount).toBeUndefined();
    expect(json.pendingApplicationCount).toBeUndefined();
    expect('note' in json).toBe(false);
    expect('viewerApplicationStatus' in json).toBe(false);
    expect('applicationCount' in json).toBe(false);
    expect('pendingApplicationCount' in json).toBe(false);
  });

  it('학생 개인화 필드를 그대로 통과시킨다', () => {
    const dto = ProgramListResponseDto.from(
      baseItem({
        viewerApplicationStatus: ApplicationStatus.SUBMITTED,
        note: { text: '지원서 제출됨 · 교직원 승인을 기다립니다' },
      }),
    );

    expect(dto.viewerApplicationStatus).toBe(ApplicationStatus.SUBMITTED);
    expect(dto.note).toEqual({
      text: '지원서 제출됨 · 교직원 승인을 기다립니다',
    });
    expect(dto.applicationCount).toBeUndefined();
    expect(dto.pendingApplicationCount).toBeUndefined();
  });

  it('교직원 집계 필드와 팀 아이콘을 그대로 통과시킨다', () => {
    const dto = ProgramListResponseDto.from(
      baseItem({
        applicationCount: 3,
        pendingApplicationCount: 1,
        note: { text: '지원 3건 · 승인 대기 1건', icon: 'team' },
      }),
    );

    expect(dto.applicationCount).toBe(3);
    expect(dto.pendingApplicationCount).toBe(1);
    expect(dto.note).toEqual({
      text: '지원 3건 · 승인 대기 1건',
      icon: 'team',
    });
  });
});

describe('ProgramListPageResponseDto', () => {
  it('페이지의 각 item 을 ProgramListResponseDto 로 변환한다', () => {
    const page = ProgramListPageResponseDto.from({
      items: [baseItem(), baseItem({ id: 'program-2' })],
      page: 1,
      pageSize: 20,
      totalItems: 2,
      totalPages: 1,
    });

    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toBeInstanceOf(ProgramListResponseDto);
    expect(page.items.map((item) => item.id)).toEqual([
      'program-1',
      'program-2',
    ]);
  });
});

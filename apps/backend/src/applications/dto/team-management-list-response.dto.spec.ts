import { ApplicationStatus } from '@prisma/client';
import type {
  TeamManagementListItem,
  TeamManagementListPage,
} from '../applications.repository';
import {
  TeamManagementListItemResponseDto,
  TeamManagementListPageResponseDto,
} from './team-management-list-response.dto';

const ITEM: TeamManagementListItem = {
  id: 'synthetic-application',
  programId: 'synthetic-program',
  status: ApplicationStatus.SUBMITTED,
  submittedAt: new Date('2026-08-05T05:32:00.000Z'),
  rejectionReason: null,
  applicant: {
    id: 'synthetic-applicant',
    name: '합성 신청자',
    nickname: 'applicant-login',
  },
  team: {
    id: 'synthetic-team',
    name: '합성 팀',
    memberCount: 2,
    members: [
      { id: 'synthetic-applicant', name: '합성 신청자', nickname: 'applicant-login' },
      { id: 'synthetic-member', name: null, nickname: 'member-login' },
    ],
  },
};

it('네 열에 필요한 값만 싣고 저장소 어휘는 키조차 없다', () => {
  // When
  const dto = TeamManagementListItemResponseDto.from(ITEM);

  // Then
  expect(Object.keys(dto).sort()).toEqual([
    'applicant',
    'id',
    'programId',
    'rejectionReason',
    'status',
    'submittedAt',
    'team',
  ]);
  expect(dto.submittedAt).toBe('2026-08-05T05:32:00.000Z');
});

it('실명이 없는 팀원은 null 로 내려가 화면이 계정으로 대신 쓴다', () => {
  // When
  const dto = TeamManagementListItemResponseDto.from(ITEM);

  // Then: 빈 문자열로 뭉개지 않는다 — 없는 것과 비어 있는 것을 가른다.
  expect(dto.team?.members[1]).toEqual({
    id: 'synthetic-member',
    name: null,
    nickname: 'member-login',
  });
});

it('페이지 메타는 서버 페이지네이션 값을 그대로 옮긴다', () => {
  // Given
  const page: TeamManagementListPage = {
    items: [ITEM],
    page: 3,
    pageSize: 20,
    totalItems: 45,
    totalPages: 3,
  };

  // When
  const dto = TeamManagementListPageResponseDto.from(page);

  // Then
  expect(dto).toMatchObject({
    page: 3,
    pageSize: 20,
    totalItems: 45,
    totalPages: 3,
  });
  expect(dto.items).toHaveLength(1);
});

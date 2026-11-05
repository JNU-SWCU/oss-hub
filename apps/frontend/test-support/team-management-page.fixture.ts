import type { TeamManagementListPage } from '../src/features/programs/applications/dto';

export function teamManagementPage(
  page: number,
  programId = 'program-1',
): TeamManagementListPage {
  const numbers =
    page === 1 ? Array.from({ length: 100 }, (_, index) => index + 1) : [101];
  return {
    items: numbers.map((number) => ({
      id: 'team-' + number,
      programId,
      teamMinSize: 1,
      status: 'APPROVED',
      submittedAt: '2026-08-01T00:00:00.000Z',
      rejectionReason: null,
      applicant: {
        id: 'user-' + number,
        name: '합성 학생',
        nickname: 'synthetic-' + number,
      },
      team: {
        id: 'team-' + number,
        name: '합성 팀 ' + number,
        memberCount: 1,
        members: [
          {
            id: 'user-' + number,
            name: '합성 학생',
            nickname: 'synthetic-' + number,
          },
        ],
      },
    })),
    page,
    pageSize: 100,
    totalItems: 101,
    totalPages: 2,
  };
}

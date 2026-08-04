import type {
  BoardAuthorRole,
  BoardComment,
  BoardPostCategory,
  BoardPostDetail,
  BoardPostSummary,
} from '@/features/board/types';

/**
 * 게시판 픽스처. 프로토타입 수치(캡스톤 3건)를 캡스톤 프로그램에 반영하고,
 * 나머지 두 프로그램은 program-overview-fixtures.ts의 `boardPostCount`와
 * 맞춘다(경진대회 1건, 기초 스터디 0건).
 *
 * 학생 작성 글의 작성자는 캡스톤 팀장(student-program-fixtures.ts의
 * `synthetic-user-01`)으로 맞춰 "내 글" 수정·삭제 검토가 가능하게 한다.
 * 교직원·관리자는 하나의 합성 계정을 공유한다 — 두 페르소나 모두 "교직원"
 * 권한만 검토하면 충분하고, 서로 다른 계정으로 나누면 검토 가치 없이 글쓴이
 * 판정만 복잡해진다.
 */
export const BOARD_STAFF_ACTOR_ID = 'synthetic-staff-01';
export const BOARD_STUDENT_ACTOR_ID = 'synthetic-user-01';

interface BoardCommentSeed {
  readonly id: string;
  readonly authorId: string;
  readonly authorRole: BoardAuthorRole;
  readonly body: string;
  readonly createdAt: string;
}

interface BoardPostSeed {
  readonly id: string;
  readonly authorId: string;
  readonly category: BoardPostCategory;
  readonly title: string;
  readonly body: string;
  readonly pinned: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly comments: readonly BoardCommentSeed[];
}

const CAPSTONE_POSTS: readonly BoardPostSeed[] = [
  {
    id: 'synthetic-post-capstone-1',
    authorId: BOARD_STAFF_ACTOR_ID,
    category: 'NOTICE',
    title: '캡스톤 중간 점검 일정 안내',
    body: '7월 마지막 주에 팀별 중간 점검을 진행합니다. 발표 순서는 추후 별도 공지합니다.',
    pinned: true,
    createdAt: '2026-07-20T01:00:00.000Z',
    updatedAt: '2026-07-20T01:00:00.000Z',
    comments: [],
  },
  {
    id: 'synthetic-post-capstone-2',
    authorId: BOARD_STUDENT_ACTOR_ID,
    category: 'QNA',
    title: '팀 저장소 접근 권한 관련 질문입니다',
    body: '새로 합류한 팀원의 GitHub 저장소 권한은 어떻게 요청하나요?',
    pinned: false,
    createdAt: '2026-07-22T05:30:00.000Z',
    updatedAt: '2026-07-22T05:30:00.000Z',
    comments: [
      {
        id: 'synthetic-comment-capstone-2-1',
        authorId: BOARD_STAFF_ACTOR_ID,
        authorRole: 'STAFF',
        body: '신청 승인 시 GitHub 조직에 자동으로 초대됩니다. 초대 메일을 확인해 주세요.',
        createdAt: '2026-07-22T06:10:00.000Z',
      },
    ],
  },
  {
    id: 'synthetic-post-capstone-3',
    authorId: BOARD_STAFF_ACTOR_ID,
    category: 'NOTICE',
    title: '최종 발표 장소 변경 안내',
    body: '최종 발표 장소가 공학관 대강당으로 변경되었습니다.',
    pinned: false,
    createdAt: '2026-07-28T08:00:00.000Z',
    updatedAt: '2026-07-28T08:00:00.000Z',
    comments: [],
  },
];

const CONTEST_POSTS: readonly BoardPostSeed[] = [
  {
    id: 'synthetic-post-contest-1',
    authorId: BOARD_STAFF_ACTOR_ID,
    category: 'NOTICE',
    title: '예선 심사 결과 발표 안내',
    body: '예선 심사 결과는 다음 주 중 개별 안내됩니다.',
    pinned: false,
    createdAt: '2026-07-25T02:00:00.000Z',
    updatedAt: '2026-07-25T02:00:00.000Z',
    comments: [],
  },
];

const BOARD_POSTS_BY_PROGRAM: Readonly<
  Record<string, readonly BoardPostSeed[]>
> = {
  'program-capstone': CAPSTONE_POSTS,
  'program-oss-contest': CONTEST_POSTS,
  // 개인형 프로그램이라 게시판 글이 아직 없다.
  'program-basic-study': [],
};

/**
 * 학생 페르소나의 게시판 접근 가능 여부 — 실제 BoardAccessGuard는 해당
 * 프로그램에 `APPROVED` 신청이 있어야 통과시킨다. student-program-fixtures.ts의
 * `studentApplicationStatus`와 같은 값으로 맞춘다(캡스톤·경진대회는 승인,
 * 기초 스터디는 신청 전).
 */
const STUDENT_BOARD_ACCESS: Readonly<Record<string, boolean>> = {
  'program-capstone': true,
  'program-oss-contest': true,
  'program-basic-study': false,
};

export function studentHasBoardAccess(programId: string): boolean {
  return STUDENT_BOARD_ACCESS[programId] ?? false;
}

function toSummary(programId: string, seed: BoardPostSeed): BoardPostSummary {
  return {
    id: seed.id,
    programId,
    authorId: seed.authorId,
    category: seed.category,
    title: seed.title,
    pinned: seed.pinned,
    createdAt: seed.createdAt,
    commentCount: seed.comments.length,
  };
}

function toComment(postId: string, seed: BoardCommentSeed): BoardComment {
  return {
    id: seed.id,
    postId,
    authorId: seed.authorId,
    authorRole: seed.authorRole,
    body: seed.body,
    createdAt: seed.createdAt,
  };
}

function toDetail(programId: string, seed: BoardPostSeed): BoardPostDetail {
  return {
    id: seed.id,
    programId,
    authorId: seed.authorId,
    category: seed.category,
    title: seed.title,
    body: seed.body,
    pinned: seed.pinned,
    createdAt: seed.createdAt,
    updatedAt: seed.updatedAt,
    commentCount: seed.comments.length,
    comments: seed.comments.map((comment) => toComment(seed.id, comment)),
  };
}

export function boardPostsFor(programId: string): readonly BoardPostSummary[] {
  const seeds = BOARD_POSTS_BY_PROGRAM[programId] ?? [];
  return seeds.map((seed) => toSummary(programId, seed));
}

export function boardPostDetailFor(
  programId: string,
  postId: string,
): BoardPostDetail | null {
  const seed = (BOARD_POSTS_BY_PROGRAM[programId] ?? []).find(
    (candidate) => candidate.id === postId,
  );
  return seed === undefined ? null : toDetail(programId, seed);
}

export function boardActorId(role: 'STUDENT' | 'STAFF' | 'ADMIN'): string {
  return role === 'STUDENT' ? BOARD_STUDENT_ACTOR_ID : BOARD_STAFF_ACTOR_ID;
}

/** 게시판 응답용 작성자 역할 — ADMIN도 원본 값을 그대로 실어 보낸다(백엔드 계약). */
export function boardActorRole(
  role: 'STUDENT' | 'STAFF' | 'ADMIN',
): BoardAuthorRole {
  return role;
}

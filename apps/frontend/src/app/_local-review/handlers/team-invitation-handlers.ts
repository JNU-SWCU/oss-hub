import { apiPath } from '@/lib/api-client';
import {
  accepted,
  json,
  matchGet,
  matchPath,
  problem,
  unauthenticated,
  type LocalReviewContext,
  type LocalReviewHandler,
} from '../handler-kit';
import {
  invitationFor,
  RECEIVED_INVITATIONS,
  searchCandidatesFor,
  sentInvitationsFor,
  STUDENT_TEAM_ID,
} from './team-invitation-fixtures';

/**
 * 팀 초대 화면의 로컬 검토 응답.
 * 담당 경로: `team-invitations/received`(GET), `.../teams/:teamId/sent`(GET),
 * `.../teams/:teamId/search`(GET), `.../teams/:teamId/invitations`(POST),
 * `.../:invitationId/cancel|decline|accept`(POST).
 *
 * 실제 백엔드는 class-level `SessionGuard`만 두므로(team-invitations.controller.ts)
 * 비로그인은 항상 401(AUT_003)이다. 초대 생성은 팀장만 할 수 있는데(TIV_003), 로컬
 * 검토 학생 페르소나는 항상 캡스톤 팀장(synthetic-user-01)이라 학생은 통과시키고,
 * 팀이 없는 교직원·관리자가 시도하면 403(TIV_003)을 준다.
 */

function matchMethod(
  context: LocalReviewContext,
  method: string,
  pattern: string,
): Record<string, string> | null {
  return context.method === method ? matchPath(pattern, context.path) : null;
}

const receivedHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'team-invitations/received');
  if (params === null) return null;
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  // 로컬 검토에서 초대를 받는 사람은 학생 페르소나뿐이다 — 교직원·관리자는 팀이 없다.
  return json(200, context.role === 'STUDENT' ? RECEIVED_INVITATIONS : []);
};

const sentHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'team-invitations/teams/:teamId/sent');
  if (params === null) return null;
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  return json(200, sentInvitationsFor(params.teamId ?? ''));
};

const searchHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'team-invitations/teams/:teamId/search');
  if (params === null) return null;
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  const query = context.searchParams.get('query') ?? '';
  return json(200, searchCandidatesFor(query));
};

/** 한계: 저장되지 않아 다시 열면 새 초대가 "보낸 초대" 목록에 나타나지 않는다. */
const createInvitationHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'POST',
    'team-invitations/teams/:teamId/invitations',
  );
  if (params === null) return null;
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  if (context.role !== 'STUDENT') {
    return problem(
      403,
      'TIV_003',
      apiPath(context.path),
      '팀장만 초대할 수 있습니다.',
    );
  }
  return accepted({
    id: 'synthetic-invitation-created',
    teamId: params.teamId ?? STUDENT_TEAM_ID,
    programId: 'program-capstone',
    invitedById: 'synthetic-user-01',
    status: 'PENDING',
    invitedAt: '2026-08-01T00:00:00.000Z',
    respondedAt: null,
  });
};

const cancelInvitationHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'POST',
    'team-invitations/:invitationId/cancel',
  );
  if (params === null) return null;
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  return accepted();
};

const declineInvitationHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'POST',
    'team-invitations/:invitationId/decline',
  );
  if (params === null) return null;
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  return accepted();
};

const acceptInvitationHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'POST',
    'team-invitations/:invitationId/accept',
  );
  if (params === null) return null;
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  const invitation = invitationFor(params.invitationId ?? '');
  return accepted({
    teamId: invitation.teamId,
    programId: invitation.programId,
  });
};

export const TEAM_INVITATION_HANDLERS: readonly LocalReviewHandler[] = [
  receivedHandler,
  sentHandler,
  searchHandler,
  createInvitationHandler,
  cancelInvitationHandler,
  declineInvitationHandler,
  acceptInvitationHandler,
];

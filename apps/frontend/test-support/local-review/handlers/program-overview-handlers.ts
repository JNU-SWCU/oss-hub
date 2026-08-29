import {
  json,
  matchGet,
  notFound,
  unauthenticated,
  type LocalReviewHandler,
} from '../handler-kit';
import {
  programOverviewFor,
  programTeamDirectoryFor,
} from './program-overview-fixtures';
import { isPublicProgramId } from './student-program-fixtures';

/**
 * 프로그램 개요(팩트 바)·팀 명단 화면의 로컬 검토 응답.
 * 담당 경로: `programs/:programId/overview`, `programs/:programId/overview/teams`.
 *
 * 실제 백엔드는 두 라우트 모두 class-level `SessionGuard`를 두므로(programOverviewController),
 * 비로그인은 항상 401(`AUT_003`)이다.
 */

const PROGRAM_NOT_FOUND_CODE = 'POV_001';

const programOverviewHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'programs/:programId/overview');
  if (params === null) return null;
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  const programId = params.programId ?? '';
  if (!isPublicProgramId(programId)) {
    return notFound(PROGRAM_NOT_FOUND_CODE, context.path);
  }
  return json(200, programOverviewFor(programId, context.role));
};

const programOverviewTeamsHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'programs/:programId/overview/teams');
  if (params === null) return null;
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  const programId = params.programId ?? '';
  if (!isPublicProgramId(programId)) {
    return notFound(PROGRAM_NOT_FOUND_CODE, context.path);
  }
  return json(200, programTeamDirectoryFor(programId));
};

export const PROGRAM_OVERVIEW_HANDLERS: readonly LocalReviewHandler[] = [
  programOverviewHandler,
  programOverviewTeamsHandler,
];

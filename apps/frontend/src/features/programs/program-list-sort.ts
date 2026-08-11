import {
  PROGRAM_LIST_DIRECTIONS,
  PROGRAM_LIST_SORTS,
  type ProgramListDirection,
  type ProgramListSort,
  type ProgramListStatus,
} from './types';

/**
 * `/programs` 정렬 컨트롤 <-> URL `?sort=&direction=` 매핑.
 * `admin-access-list-query.ts`/`admin-access-url-state.ts`의 구조를 그대로 따른다.
 *
 * 무효값 정책: 값이 없거나 알 수 없으면 `undefined`로 수렴한다(에러 상태를 만들지
 * 않는다) — backend가 `sort` 생략을 "레거시 기본 정렬"로 이미 처리하므로 프론트도
 * 같은 결을 유지한다.
 */

export function parseProgramListSort(
  value: string | null,
): ProgramListSort | undefined {
  if (
    value !== null &&
    (PROGRAM_LIST_SORTS as readonly string[]).includes(value)
  ) {
    return value as ProgramListSort;
  }
  return undefined;
}

export function parseProgramListDirection(
  value: string | null,
): ProgramListDirection | undefined {
  if (
    value !== null &&
    (PROGRAM_LIST_DIRECTIONS as readonly string[]).includes(value)
  ) {
    return value as ProgramListDirection;
  }
  return undefined;
}

export interface ProgramListUrlState {
  readonly status: ProgramListStatus;
  readonly sort?: ProgramListSort;
  readonly direction?: ProgramListDirection;
}

/**
 * URL 상태 → `/programs` href. 기본값(전체 상태, 정렬 없음, asc)은 쿼리에서
 * 생략해 canonical URL을 짧게 유지한다 — `admin-access-url-state.ts`와 동일 원칙.
 * `sort`가 없으면 `direction`도 의미가 없으므로 함께 생략한다.
 */
export function buildProgramListHref(state: ProgramListUrlState): string {
  const params = new URLSearchParams();
  if (state.status !== 'all') params.set('status', state.status);
  if (state.sort) {
    params.set('sort', state.sort);
    if (state.direction && state.direction !== 'asc') {
      params.set('direction', state.direction);
    }
  }
  const query = params.toString();
  return query ? `/programs?${query}` : '/programs';
}

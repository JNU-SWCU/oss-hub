import { describe, expect, it } from 'vitest';

import {
  ADMIN_ACCESS_DEFAULT_FILTER_STATE,
  APPLICANT_QUEUE_DEFAULT_FILTER_STATE,
} from './admin-access-list-query';
import type { AdminAccessListFilterState } from './admin-access-list-query';
import {
  buildAdminAccessSearchParams,
  buildApplicantQueueSearchParams,
  parseAdminAccessSearchParams,
  parseApplicantQueueSearchParams,
} from './admin-access-url-state';

function parse(query: string) {
  return parseAdminAccessSearchParams(new URLSearchParams(query));
}

describe('parseAdminAccessSearchParams — URL → 상태 (7개 파라미터 전부)', () => {
  it('쿼리 문자열이 없으면 기본 상태를 반환한다', () => {
    expect(parse('')).toEqual(ADMIN_ACCESS_DEFAULT_FILTER_STATE);
  });

  it('query 파라미터를 읽고 앞뒤 공백을 정리한다', () => {
    expect(parse('query=%20합성%20검색어%20').query).toBe('합성 검색어');
  });

  it('role 파라미터의 허용값(UNASSIGNED/STUDENT/STAFF/ADMIN)을 모두 읽는다', () => {
    expect(parse('role=UNASSIGNED').role).toBe('UNASSIGNED');
    expect(parse('role=STUDENT').role).toBe('STUDENT');
    expect(parse('role=STAFF').role).toBe('STAFF');
    expect(parse('role=ADMIN').role).toBe('ADMIN');
  });

  it('accountStatus 파라미터의 허용값(ACTIVE/DEACTIVATED)을 읽는다', () => {
    expect(parse('accountStatus=ACTIVE').accountStatus).toBe('ACTIVE');
    expect(parse('accountStatus=DEACTIVATED').accountStatus).toBe(
      'DEACTIVATED',
    );
  });

  it('pendingRequest 파라미터의 허용값(NONE/PENDING)을 읽는다', () => {
    expect(parse('pendingRequest=NONE').pendingRequest).toBe('NONE');
    expect(parse('pendingRequest=PENDING').pendingRequest).toBe('PENDING');
  });

  it('sort 파라미터의 허용값(name/createdAt/lastLoginAt/role/accountStatus)을 읽는다', () => {
    expect(parse('sort=name').sort).toBe('name');
    expect(parse('sort=createdAt').sort).toBe('createdAt');
    expect(parse('sort=lastLoginAt').sort).toBe('lastLoginAt');
    expect(parse('sort=role').sort).toBe('role');
    expect(parse('sort=accountStatus').sort).toBe('accountStatus');
  });

  it('direction 파라미터의 허용값(asc/desc)을 읽는다', () => {
    expect(parse('direction=asc').direction).toBe('asc');
    expect(parse('direction=desc').direction).toBe('desc');
  });

  it('page 파라미터의 양의 정수를 읽는다', () => {
    expect(parse('page=1').page).toBe(1);
    expect(parse('page=42').page).toBe(42);
  });
});

describe('parseAdminAccessSearchParams — 잘못된 파라미터 정책 (파라미터마다 기본값으로 폴백, 오류 화면 없음)', () => {
  it('role이 허용값이 아니면 전체(빈 값)로 폴백한다', () => {
    expect(parse('role=nonsense').role).toBe('');
  });

  it('accountStatus가 허용값이 아니면 전체(빈 값)로 폴백한다', () => {
    expect(parse('accountStatus=nonsense').accountStatus).toBe('');
  });

  it('pendingRequest가 허용값이 아니면 전체(빈 값)로 폴백한다', () => {
    expect(parse('pendingRequest=nonsense').pendingRequest).toBe('');
  });

  it('sort가 허용값이 아니면 기본 정렬(name)로 폴백한다', () => {
    expect(parse('sort=bogus').sort).toBe('name');
  });

  it('direction이 허용값이 아니면 기본 방향(asc)으로 폴백한다', () => {
    expect(parse('direction=upsidedown').direction).toBe('asc');
  });

  it('page가 음수이면 1로 폴백한다', () => {
    expect(parse('page=-1').page).toBe(1);
  });

  it('page가 0이면 1로 폴백한다', () => {
    expect(parse('page=0').page).toBe(1);
  });

  it('page가 소수이면 1로 폴백한다', () => {
    expect(parse('page=1.5').page).toBe(1);
  });

  it('page가 숫자가 아니면 1로 폴백한다', () => {
    expect(parse('page=abc').page).toBe(1);
  });

  it('page에 선행 0이 있으면 1로 폴백한다', () => {
    expect(parse('page=01').page).toBe(1);
  });

  it('page가 안전 정수 범위를 넘으면 1로 폴백한다', () => {
    expect(parse('page=99999999999999999999').page).toBe(1);
  });

  it('query는 공백만 있으면 빈 문자열로 정리된다(형식상 무효 값이 없는 자유 텍스트 필드)', () => {
    expect(parse('query=%20%20%20').query).toBe('');
  });

  it('여러 파라미터가 동시에 잘못되어도 각각 독립적으로 폴백하고 나머지 유효한 값은 유지한다', () => {
    const state = parse(
      'role=nope&sort=bogus&direction=sideways&page=-5&accountStatus=DEACTIVATED',
    );
    expect(state).toEqual({
      query: '',
      role: '',
      accountStatus: 'DEACTIVATED',
      pendingRequest: '',
      sort: 'name',
      direction: 'asc',
      page: 1,
    });
  });
});

describe('buildAdminAccessSearchParams — 상태 → URL', () => {
  it('기본 상태는 빈 쿼리 문자열을 만든다(정규 URL이 가장 짧다)', () => {
    expect(
      buildAdminAccessSearchParams(
        ADMIN_ACCESS_DEFAULT_FILTER_STATE,
      ).toString(),
    ).toBe('');
  });

  it('기본값이 아닌 필드만 쿼리 문자열에 포함한다', () => {
    const state: AdminAccessListFilterState = {
      ...ADMIN_ACCESS_DEFAULT_FILTER_STATE,
      role: 'ADMIN',
      page: 3,
    };
    const search = buildAdminAccessSearchParams(state);
    expect(search.get('role')).toBe('ADMIN');
    expect(search.get('page')).toBe('3');
    expect(search.has('sort')).toBe(false);
    expect(search.has('direction')).toBe(false);
  });
});

describe('URL 왕복 — 7개 파라미터 전부', () => {
  const roundTripCases: AdminAccessListFilterState[] = [
    ADMIN_ACCESS_DEFAULT_FILTER_STATE,
    {
      query: '합성 사용자',
      role: 'STAFF',
      accountStatus: 'ACTIVE',
      pendingRequest: 'PENDING',
      sort: 'lastLoginAt',
      direction: 'desc',
      page: 7,
    },
    {
      query: '',
      role: 'UNASSIGNED',
      accountStatus: 'DEACTIVATED',
      pendingRequest: 'NONE',
      sort: 'createdAt',
      direction: 'asc',
      page: 1,
    },
  ];

  it.each(roundTripCases)(
    '상태 → URL → 상태 왕복이 원래 상태와 정확히 같다 (page=%o)',
    (state) => {
      const search = buildAdminAccessSearchParams(state);
      expect(parseAdminAccessSearchParams(search)).toEqual(state);
    },
  );

  it('페이지네이션은 여러 페이지에 걸쳐 왕복 후에도 결정적이다', () => {
    for (const page of [1, 2, 3, 10, 999]) {
      const state: AdminAccessListFilterState = {
        ...ADMIN_ACCESS_DEFAULT_FILTER_STATE,
        page,
      };
      const search = buildAdminAccessSearchParams(state);
      expect(parseAdminAccessSearchParams(search).page).toBe(page);
    }
  });
});

describe('요청함(pendingRequest) 필터 왕복', () => {
  it('PENDING 상태로 이동한 URL을 다시 파싱하면 요청함 필터가 유지된다', () => {
    const search = buildAdminAccessSearchParams({
      ...ADMIN_ACCESS_DEFAULT_FILTER_STATE,
      pendingRequest: 'PENDING',
    });
    expect(search.get('pendingRequest')).toBe('PENDING');
    expect(parseAdminAccessSearchParams(search).pendingRequest).toBe('PENDING');
  });

  it('전체 목록(빈 값)으로 되돌리면 pendingRequest 파라미터가 URL에서 사라진다', () => {
    const search = buildAdminAccessSearchParams({
      ...ADMIN_ACCESS_DEFAULT_FILTER_STATE,
      pendingRequest: '',
    });
    expect(search.has('pendingRequest')).toBe(false);
  });
});

describe('가입 신청 URL 상태', () => {
  it('쿼리가 없으면 요청 시각 내림차순을 기본값으로 쓴다', () => {
    expect(parseApplicantQueueSearchParams(new URLSearchParams(''))).toEqual(
      APPLICANT_QUEUE_DEFAULT_FILTER_STATE,
    );
  });

  it('기본 상태는 query string을 만들지 않는다', () => {
    expect(
      buildApplicantQueueSearchParams(
        APPLICANT_QUEUE_DEFAULT_FILTER_STATE,
      ).toString(),
    ).toBe('');
  });

  it('pendingRequest 파라미터는 무시하고 검색·페이지는 유지한다', () => {
    const parsed = parseApplicantQueueSearchParams(
      new URLSearchParams('query=합성&pendingRequest=PENDING&page=2'),
    );
    expect(parsed.query).toBe('합성');
    expect(parsed.pendingRequest).toBe('');
    expect(parsed.page).toBe(2);
    expect(parsed.sort).toBe('createdAt');
    expect(parsed.direction).toBe('desc');
  });
});

import { Prisma } from '@prisma/client';

/**
 * 교직원 접근 요청 이력의 **물리 이름**. bridge 단계의 단일 출처다.
 *
 * 애플리케이션은 어디서나 정본 이름(`StaffAccessRequest`)으로 말한다. Prisma는
 * `@@map`으로 그 이름을 옛 물리 이름(`RoleRequest`) 위에 얹어 주므로 모델 API를
 * 쓰는 코드는 이 파일을 몰라도 된다.
 *
 * 그러나 `$queryRaw`는 `@@map`을 통과하지 않는다 — 문자열이 그대로 PostgreSQL로 간다.
 * 그래서 raw SQL만은 물리 이름을 알아야 하고, 그 지식이 여러 파일에 흩어지면
 * 다음 contract PR이 개명할 때 한 군데를 빠뜨린다. 여기 두면 개명은 이 파일
 * 두 줄을 고치는 일이 된다.
 *
 * 이 이름이 아직 옛 이름인 이유는 롤백이다. 직전 이미지 v0.6.110이 `RoleRequest`와
 * `RoleRequestStatus`를 직접 읽으므로 bridge 단계에서는 물리 개명을 하지 않는다.
 */
export const STAFF_ACCESS_REQUEST_TABLE_NAME = 'RoleRequest';

export const STAFF_ACCESS_REQUEST_TABLE = Prisma.raw(
  `"${STAFF_ACCESS_REQUEST_TABLE_NAME}"`,
);

export const STAFF_ACCESS_REQUEST_STATUS_TYPE = Prisma.raw(
  '"RoleRequestStatus"',
);

/**
 * 이력 페이지 조회를 받치는 인덱스의 물리 이름.
 *
 * 인덱스 이름도 `@@map`을 통과하지 않는다 — `pg_indexes`와 `EXPLAIN` 출력은 언제나
 * 물리 이름을 쓴다. 테이블 이름과 같은 이유로 여기 함께 둔다.
 */
export const STAFF_ACCESS_REQUEST_USER_CREATED_INDEX = `${STAFF_ACCESS_REQUEST_TABLE_NAME}_userId_createdAt_id_idx`;

export const STAFF_ACCESS_REQUEST_USER_STATUS_CREATED_INDEX = `${STAFF_ACCESS_REQUEST_TABLE_NAME}_userId_status_createdAt_id_idx`;

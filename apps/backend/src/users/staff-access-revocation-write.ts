import { StaffAccessRequestStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type {
  AdminAccessInsertedRequest,
  AdminAccessRevokedRequestInsert,
} from './admin-access.repository.types';

/**
 * 교직원 접근을 회수한 두 경로가 공유하는 **회수 이력 쓰기**다.
 *
 * 회수 경로는 둘이다 — 옛 CAS(`admin-access-mutation.service.ts`)와 화면이 실제로 쓰는
 * 독립 권한 API(`independent-authority.service.ts`). 두 경로가 각자 행을 만들면 모양이
 * 갈라지고, 그러면 이 표를 읽는 자리들이 어느 경로로 회수됐는지에 따라 다르게 판정한다.
 * 읽는 자리는 재신청 판정(`roles/roles.service.ts`), 로그인 시드 가드
 * (`auth/auth.repository.ts`), 관리자 상세의 신청 이력(`admin-access-history.repository.ts`)
 * 셋이고 모두 "회수 행이 있는가"만 본다(#1383).
 *
 * partial unique(`StaffAccessRequest_userId_pending_key`)는 PENDING 행만 묶으므로
 * REVOKED 행은 몇 번을 회수하든 매번 새로 쌓인다 — 회수·재승인이 반복된 사람의
 * 이력이 관리자 상세에서 시간순으로 그대로 읽힌다.
 *
 * 호출부는 권한을 끄는 쓰기와 **같은 트랜잭션**에서 부른다. 두 쓰기가 갈리면
 * "권한은 꺼졌는데 회수 이력은 없는" 순간이 커밋 사이에 노출되고, 그 순간에 로그인이
 * 끼면 시드가 권한을 되살린다.
 */
export async function insertRevokedStaffAccessRequest(
  transaction: Prisma.TransactionClient,
  input: AdminAccessRevokedRequestInsert,
): Promise<AdminAccessInsertedRequest> {
  const created = await transaction.staffAccessRequest.create({
    data: {
      userId: input.userId,
      status: StaffAccessRequestStatus.REVOKED,
      decidedById: input.actorId,
      decidedAt: input.decidedAt,
    },
    select: { id: true },
  });
  return { id: created.id };
}

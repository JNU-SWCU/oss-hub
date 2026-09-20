import { ApplicationReviewEventKind } from '@prisma/client';
import type { Prisma } from '@prisma/client';

/**
 * 판정 이력 append의 유일한 writer.
 *
 * 신청 상태가 바뀌는 지점은 세 곳이다 — 생성(`ApplicationCreateStore`),
 * 판정(`ApplicationsTransactionStore`), 학생 재제출(`StudentResubmissionStore`).
 * 세 곳이 각자 `applicationReviewHistory.create`를 부르면 회차 규칙이 경로마다 갈리고,
 * 어느 한 곳이 이력을 빼먹어도 타입이 잡아 주지 않는다. 그래서 이력 쓰기는 이 파일 하나만
 * 하고, 세 store가 **자기 트랜잭션 client로** 이 함수를 부른다.
 *
 * `Prisma.TransactionClient` 전체를 받지 않는다. 그 타입을 받으면 이력 writer를 통해
 * 트랜잭션 전권이 새어 나가고, 「상태 변경과 같은 트랜잭션에서만 append한다」는 계약이
 * 타입이 아니라 규율로만 남는다. 필요한 두 면만 받는다.
 */
export type ReviewHistoryWriterClient = Pick<
  Prisma.TransactionClient,
  'application' | 'applicationReviewHistory'
>;

export interface AppendReviewHistoryInput {
  readonly applicationId: string;
  readonly eventKind: ApplicationReviewEventKind;
  /** 이 사건을 일으킨 사람 — 제출·재제출은 학생, 판정은 교직원이다. */
  readonly actorId: string;
  readonly occurredAt: Date;
  /** 반려 사유. 반려가 아닌 사건에 값을 실어 보내도 저장되지 않는다. */
  readonly rejectionReason: string | null;
}

export interface AppendedReviewHistory {
  /** 이 사건이 가리키는 신청서 회차. 재제출이면 방금 올라간 값이다. */
  readonly revision: number;
}

/**
 * 이력을 남길 신청이 없다 — 호출자가 잠근 행이 사라졌거나 애초에 없는 id를 넘겼다.
 * 조용히 건너뛰지 않고 던져서 트랜잭션 전체를 롤백시킨다.
 */
export class ApplicationReviewHistoryTargetMissingError extends Error {
  override readonly name = 'ApplicationReviewHistoryTargetMissingError';

  constructor(readonly applicationId: string) {
    super('append 대상 신청을 찾을 수 없다');
  }
}

/**
 * 상태 변경과 **같은 트랜잭션에서** 판정 이력 한 행을 쌓는다.
 *
 * 호출자는 이 함수를 부르기 전에 이미 Application 행을 잠그고 있어야 한다. 판정 경로는
 * `transitionApplication`의 CAS가, 생성 경로는 같은 트랜잭션의 `application.create`가,
 * 재제출 경로는 `SELECT ... FOR UPDATE`가 그 잠금이다. 잠금 없이 부르면 동시 판정·재제출이
 * 같은 회차를 서로 다르게 읽는다.
 *
 * 회차 규칙은 여기 한 곳에만 있다.
 * - 재제출(`RESUBMITTED`)만 `Application.revision`을 1 올리고 올라간 값을 쓴다.
 * - 나머지 사건(`SUBMITTED`·`APPROVED`·`REJECTED`·`REVERTED`)은 현재 값을 그대로 복사한다.
 *   최초 제출이 1인 것은 `Application.revision @default(1)`이 이미 보장한다 — 생성 경로가
 *   상수 1을 따로 적지 않게 해서 기본값과 이력이 어긋날 여지를 없앤다.
 */
export async function appendReviewHistory(
  client: ReviewHistoryWriterClient,
  input: AppendReviewHistoryInput,
): Promise<AppendedReviewHistory> {
  const revision = await resolveRevision(client, input);
  await client.applicationReviewHistory.create({
    data: {
      applicationId: input.applicationId,
      eventKind: input.eventKind,
      revision,
      actorId: input.actorId,
      occurredAt: input.occurredAt,
      rejectionReason:
        input.eventKind === ApplicationReviewEventKind.REJECTED
          ? input.rejectionReason
          : null,
    },
  });
  return { revision };
}

async function resolveRevision(
  client: ReviewHistoryWriterClient,
  input: AppendReviewHistoryInput,
): Promise<number> {
  if (input.eventKind === ApplicationReviewEventKind.RESUBMITTED) {
    // `update`는 대상이 없으면 P2025로 던진다 — 조용한 0행 갱신이 되지 않게 `update`를 쓴다.
    const bumped = await client.application.update({
      where: { id: input.applicationId },
      data: { revision: { increment: 1 } },
      select: { revision: true },
    });
    return bumped.revision;
  }
  const current = await client.application.findUnique({
    where: { id: input.applicationId },
    select: { revision: true },
  });
  if (current === null) {
    throw new ApplicationReviewHistoryTargetMissingError(input.applicationId);
  }
  return current.revision;
}

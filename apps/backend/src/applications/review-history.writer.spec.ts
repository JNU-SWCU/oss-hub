import { ApplicationReviewEventKind } from '@prisma/client';
import {
  ApplicationReviewHistoryTargetMissingError,
  appendReviewHistory,
} from './review-history.writer';
import type { ReviewHistoryWriterClient } from './review-history.writer';

const APPLICATION_ID = 'synthetic-application';
const ACTOR_ID = 'synthetic-actor';
const OCCURRED_AT = new Date('2026-09-20T03:00:00.000Z');

type CreatedRow = {
  readonly applicationId: string;
  readonly eventKind: ApplicationReviewEventKind;
  readonly revision: number;
  readonly actorId: string;
  readonly occurredAt: Date;
  readonly rejectionReason: string | null;
};

function fakeClient(options: { readonly revision: number | null }) {
  const created: CreatedRow[] = [];
  let stored = options.revision;
  const update = jest.fn(() => {
    if (stored === null) {
      return Promise.reject(new Error('P2025: record to update not found'));
    }
    stored += 1;
    return Promise.resolve({ revision: stored });
  });
  const findUnique = jest.fn(() =>
    Promise.resolve(stored === null ? null : { revision: stored }),
  );
  const create = jest.fn((args: { readonly data: CreatedRow }) => {
    created.push(args.data);
    return Promise.resolve(args.data);
  });
  const client = {
    application: { update, findUnique },
    applicationReviewHistory: { create },
  } as unknown as ReviewHistoryWriterClient;
  return { client, created, update, findUnique, create };
}

function input(
  eventKind: ApplicationReviewEventKind,
  rejectionReason: string | null = null,
) {
  return {
    applicationId: APPLICATION_ID,
    eventKind,
    actorId: ACTOR_ID,
    occurredAt: OCCURRED_AT,
    rejectionReason,
  };
}

it('최초 제출은 Application 기본 회차 1을 그대로 쓴다', async () => {
  const { client, created, update } = fakeClient({ revision: 1 });

  const result = await appendReviewHistory(
    client,
    input(ApplicationReviewEventKind.SUBMITTED),
  );

  expect(result).toEqual({ revision: 1 });
  expect(created).toEqual([
    {
      applicationId: APPLICATION_ID,
      eventKind: ApplicationReviewEventKind.SUBMITTED,
      revision: 1,
      actorId: ACTOR_ID,
      occurredAt: OCCURRED_AT,
      rejectionReason: null,
    },
  ]);
  expect(update).not.toHaveBeenCalled();
});

it('재제출만 회차를 1 올리고 올라간 값을 기록한다', async () => {
  const { client, created, update } = fakeClient({ revision: 2 });

  const result = await appendReviewHistory(
    client,
    input(ApplicationReviewEventKind.RESUBMITTED),
  );

  expect(result).toEqual({ revision: 3 });
  expect(created[0]?.revision).toBe(3);
  expect(update).toHaveBeenCalledWith({
    where: { id: APPLICATION_ID },
    data: { revision: { increment: 1 } },
    select: { revision: true },
  });
});

it.each([
  ApplicationReviewEventKind.APPROVED,
  ApplicationReviewEventKind.REJECTED,
  ApplicationReviewEventKind.REVERTED,
])('%s 판정은 현재 회차를 복사하고 올리지 않는다', async (eventKind) => {
  const { client, created, update } = fakeClient({ revision: 4 });

  const result = await appendReviewHistory(client, input(eventKind, '사유'));

  expect(result).toEqual({ revision: 4 });
  expect(created[0]?.revision).toBe(4);
  expect(update).not.toHaveBeenCalled();
});

it('연속 재제출은 회차가 1씩만 전진한다', async () => {
  const { client, created } = fakeClient({ revision: 1 });

  await appendReviewHistory(
    client,
    input(ApplicationReviewEventKind.RESUBMITTED),
  );
  await appendReviewHistory(client, input(ApplicationReviewEventKind.APPROVED));
  await appendReviewHistory(
    client,
    input(ApplicationReviewEventKind.RESUBMITTED),
  );

  expect(created.map((row) => row.revision)).toEqual([2, 2, 3]);
});

it('반려 사유는 반려 사건에만 저장된다', async () => {
  const { client, created } = fakeClient({ revision: 1 });

  await appendReviewHistory(
    client,
    input(ApplicationReviewEventKind.APPROVED, '잘못 실린 사유'),
  );
  await appendReviewHistory(
    client,
    input(ApplicationReviewEventKind.REJECTED, '서류 미비'),
  );

  expect(created[0]?.rejectionReason).toBeNull();
  expect(created[1]?.rejectionReason).toBe('서류 미비');
});

it('대상 신청이 없으면 던져서 트랜잭션을 롤백시킨다', async () => {
  const { client, create } = fakeClient({ revision: null });

  await expect(
    appendReviewHistory(client, input(ApplicationReviewEventKind.APPROVED)),
  ).rejects.toBeInstanceOf(ApplicationReviewHistoryTargetMissingError);
  expect(create).not.toHaveBeenCalled();
});

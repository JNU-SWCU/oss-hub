import { TeamHistoryEvent } from '@prisma/client';
import {
  TeamHistoryRepository,
  type ReviewHistoryWriterClient,
} from './team-history.repository';
import { ApplicationReviewHistoryTargetMissingError } from './review-history-writer.error';

const APPLICATION_ID = 'synthetic-application';
const ACTOR_ID = 'synthetic-actor';
const OCCURRED_AT = new Date('2026-09-20T03:00:00.000Z');

type CreatedRow = {
  readonly teamId: string;
  readonly event: TeamHistoryEvent;
  readonly programId: string;
  readonly source: string;
  readonly data: {
    readonly schemaVersion: number;
    readonly revision: number;
    readonly rejectionReason: string | null;
  };
  readonly actorId: string;
  readonly occurredAt: Date;
};

function fakeClient(options: { readonly revision: number | null }) {
  const created: CreatedRow[] = [];
  let stored = options.revision;
  const update = jest.fn(() => {
    if (stored === null) {
      return Promise.reject(new Error('P2025: record to update not found'));
    }
    stored += 1;
    return Promise.resolve({ revision: stored, programId: 'program-1' });
  });
  const findUnique = jest.fn(() =>
    Promise.resolve(
      stored === null ? null : { revision: stored, programId: 'program-1' },
    ),
  );
  const create = jest.fn((args: { readonly data: CreatedRow }) => {
    created.push(args.data);
    return Promise.resolve(args.data);
  });
  const client = {
    team: { update, findUnique },
    teamHistory: { create },
  } as unknown as ReviewHistoryWriterClient;
  return { client, created, update, findUnique, create };
}

function input(
  eventKind: TeamHistoryEvent,
  rejectionReason: string | null = null,
) {
  return {
    teamId: APPLICATION_ID,
    eventKind,
    actorId: ACTOR_ID,
    occurredAt: OCCURRED_AT,
    rejectionReason,
  };
}

it('최초 제출은 Team 기본 회차 1을 그대로 쓴다', async () => {
  const { client, created, update } = fakeClient({ revision: 1 });

  const result = await new TeamHistoryRepository().appendReviewHistory(
    client,
    input(TeamHistoryEvent.SUBMITTED),
  );

  expect(result).toEqual({ revision: 1 });
  expect(created).toEqual([
    {
      teamId: APPLICATION_ID,
      event: TeamHistoryEvent.SUBMITTED,
      programId: 'program-1',
      source: 'APPLICATION',
      data: { schemaVersion: 1, revision: 1, rejectionReason: null },
      actorId: ACTOR_ID,
      occurredAt: OCCURRED_AT,
    },
  ]);
  expect(update).not.toHaveBeenCalled();
});

it('재제출만 회차를 1 올리고 올라간 값을 기록한다', async () => {
  const { client, created, update } = fakeClient({ revision: 2 });

  const result = await new TeamHistoryRepository().appendReviewHistory(
    client,
    input(TeamHistoryEvent.RESUBMITTED),
  );

  expect(result).toEqual({ revision: 3 });
  expect(created[0]?.data.revision).toBe(3);
  expect(update).toHaveBeenCalledWith({
    where: { id: APPLICATION_ID },
    data: { revision: { increment: 1 } },
    select: { revision: true, programId: true },
  });
});

it.each([
  TeamHistoryEvent.APPROVED,
  TeamHistoryEvent.REJECTED,
  TeamHistoryEvent.REVERTED,
])('%s 판정은 현재 회차를 복사하고 올리지 않는다', async (eventKind) => {
  const { client, created, update } = fakeClient({ revision: 4 });

  const result = await new TeamHistoryRepository().appendReviewHistory(
    client,
    input(eventKind, '사유'),
  );

  expect(result).toEqual({ revision: 4 });
  expect(created[0]?.data.revision).toBe(4);
  expect(update).not.toHaveBeenCalled();
});

it('연속 재제출은 회차가 1씩만 전진한다', async () => {
  const { client, created } = fakeClient({ revision: 1 });

  await new TeamHistoryRepository().appendReviewHistory(
    client,
    input(TeamHistoryEvent.RESUBMITTED),
  );
  await new TeamHistoryRepository().appendReviewHistory(
    client,
    input(TeamHistoryEvent.APPROVED),
  );
  await new TeamHistoryRepository().appendReviewHistory(
    client,
    input(TeamHistoryEvent.RESUBMITTED),
  );

  expect(created.map((row) => row.data.revision)).toEqual([2, 2, 3]);
});

it('반려 사유는 반려 사건에만 저장된다', async () => {
  const { client, created } = fakeClient({ revision: 1 });

  await new TeamHistoryRepository().appendReviewHistory(
    client,
    input(TeamHistoryEvent.APPROVED, '잘못 실린 사유'),
  );
  await new TeamHistoryRepository().appendReviewHistory(
    client,
    input(TeamHistoryEvent.REJECTED, '서류 미비'),
  );

  expect(created[0]?.data.rejectionReason).toBeNull();
  expect(created[1]?.data.rejectionReason).toBe('서류 미비');
});

it('대상 신청이 없으면 던져서 트랜잭션을 롤백시킨다', async () => {
  const { client, create } = fakeClient({ revision: null });

  await expect(
    new TeamHistoryRepository().appendReviewHistory(
      client,
      input(TeamHistoryEvent.APPROVED),
    ),
  ).rejects.toBeInstanceOf(ApplicationReviewHistoryTargetMissingError);
  expect(create).not.toHaveBeenCalled();
});

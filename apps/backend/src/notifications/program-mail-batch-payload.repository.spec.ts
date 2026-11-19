import type { Prisma } from '@prisma/client';
import { ProgramMailBatchPayloadRepository } from './program-mail-batch-payload.repository';
import { ProgramMailStoredResultError } from './program-mail-send-state.error';

const codec = new ProgramMailBatchPayloadRepository();
const recipient = {
  id: 'user',
  displayName: 'Student',
  notificationEmail: 'student@example.test',
};
const content = {
  actorId: 'staff',
  programId: 'program',
  programName: 'Program',
  senderName: 'Sender',
  subject: 'Subject',
  body: 'Body',
  bodyHash: 'hash',
  bodyLength: 4,
  previewVersion: 'preview',
  occurredAt: new Date('2026-11-19T00:00:00Z'),
  recipients: [recipient],
};
const persisted = {
  ...content,
  schemaVersion: 1,
  occurredAt: content.occurredAt.toISOString(),
};
const batch = 'batch:synthetic';

it('round-trips the versioned content through the persisted JSON format', () => {
  const json = JSON.stringify(codec.payload(content));
  expect(JSON.parse(json)).toEqual(persisted);
  expect(codec.content(persisted, batch)).toEqual(content);
});

it.each<Prisma.JsonValue>([
  null,
  [],
  42,
  {},
  { ...persisted, recipients: {} },
  {
    ...persisted,
    recipients: [recipient, { ...recipient, notificationEmail: 42 }],
  },
])(
  'rejects malformed content without silently dropping recipients: %j',
  (value) =>
    expect(() => codec.content(value, batch)).toThrow(
      ProgramMailStoredResultError,
    ),
);

it('keeps invalid date strings as invalid Date values rather than inventing timestamps', () => {
  const decoded = codec.content({ ...persisted, occurredAt: 'invalid' }, batch);
  expect(decoded.occurredAt.getTime()).toBeNaN();
  expect(
    codec
      .lease({ workerId: 'worker', leaseExpiresAt: 'invalid' })
      ?.expiresAt.getTime(),
  ).toBeNaN();
});

it('accepts legacy leases without tokens but rejects a missing timestamp', () => {
  expect(
    codec.lease({ workerId: 'worker', leaseExpiresAt: persisted.occurredAt }),
  ).toEqual({
    workerId: 'worker',
    token: null,
    expiresAt: content.occurredAt,
  });
  expect(codec.lease({ workerId: 'worker' })).toBeNull();
});

const counts = { sentCount: 4, duplicateCount: 2, failedCount: 1 };

it('ignores non-completed batches and malformed results', () => {
  expect(codec.storedResult('PENDING', { result: counts })).toBeNull();
  expect(
    codec.storedResult('COMPLETED', {
      result: { ...counts, failedCount: '1' },
    }),
  ).toBeNull();
  expect(codec.storedResult('COMPLETED', { result: null })).toBeNull();
});

it('preserves explicit unknown outcomes and defaults old results to zero', () => {
  expect(codec.storedResult('COMPLETED', { result: counts })).toEqual({
    ...counts,
    unknownCount: 0,
  });
  expect(
    codec.storedResult('COMPLETED', { result: { ...counts, unknownCount: 3 } }),
  ).toEqual({ ...counts, unknownCount: 3 });
});

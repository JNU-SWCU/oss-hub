import { documentDeliveryStatus } from './document-delivery-status';

const dueAt = new Date('2026-08-14T12:00:00Z');
const early = new Date('2026-08-14T11:00:00Z');
const late = new Date('2026-08-14T12:00:00.001Z');

describe('required-document delivery axis', () => {
  it.each([
    {
      label: 'no required items',
      dates: [],
      dueAt,
      expected: 'NO_REQUIRED_ITEMS',
    },
    {
      label: 'missing wins over another late submission',
      dates: [late, null],
      dueAt,
      expected: 'MISSING',
    },
    {
      label: 'late first submission',
      dates: [early, late],
      dueAt,
      expected: 'LATE',
    },
    {
      label: 'exact deadline is on time',
      dates: [dueAt],
      dueAt,
      expected: 'COMPLETE',
    },
    {
      label: 'on-time first submission remains complete',
      dates: [early],
      dueAt,
      expected: 'COMPLETE',
    },
    {
      label: 'no deadline cannot be late',
      dates: [late],
      dueAt: null,
      expected: 'COMPLETE',
    },
    {
      label: 'no deadline still needs a required submission',
      dates: [null],
      dueAt: null,
      expected: 'MISSING',
    },
  ])('$label', ({ dates, dueAt: deadline, expected }) => {
    // Given / When
    const status = documentDeliveryStatus({
      requiredFirstSubmissions: dates,
      dueAt: deadline,
    });
    // Then
    expect(status).toBe(expected);
  });
});

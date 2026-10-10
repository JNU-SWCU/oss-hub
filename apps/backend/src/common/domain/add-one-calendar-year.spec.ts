import { addOneCalendarYear } from './add-one-calendar-year';

describe('addOneCalendarYear', () => {
  it('preserves the UTC calendar position across an ordinary year', () => {
    expect(addOneCalendarYear(new Date('2027-01-01T09:30:00.000Z'))).toEqual(
      new Date('2028-01-01T09:30:00.000Z'),
    );
  });

  it('clamps leap day to the final day of February', () => {
    expect(addOneCalendarYear(new Date('2028-02-29T00:00:00.000Z'))).toEqual(
      new Date('2029-02-28T00:00:00.000Z'),
    );
  });

  it('does not mutate the source date', () => {
    const source = new Date('2027-12-31T23:59:59.000Z');

    addOneCalendarYear(source);

    expect(source).toEqual(new Date('2027-12-31T23:59:59.000Z'));
  });
});

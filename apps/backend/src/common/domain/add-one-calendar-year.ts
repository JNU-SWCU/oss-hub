export function addOneCalendarYear(value: Date): Date {
  const result = new Date(value);
  const month = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() + 1);
  if (month === 1 && result.getUTCMonth() !== month) {
    result.setUTCDate(0);
  }
  return result;
}

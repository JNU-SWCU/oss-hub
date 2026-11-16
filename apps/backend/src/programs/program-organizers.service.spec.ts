import { ProgramOrganizersService } from './program-organizers.service';

const normalizeProgramOrganizers = (values: readonly string[]) =>
  new ProgramOrganizersService().normalize(values);

describe('ProgramOrganizersService.normalize', () => {
  it('trims labels, drops empty labels, and removes exact duplicates in order', () => {
    expect(
      normalizeProgramOrganizers([' SW Center ', '', '  ', 'OSS', 'SW Center']),
    ).toEqual({ organizers: ['SW Center', 'OSS'], error: null });
  });

  it('keeps labels that differ only by case', () => {
    expect(normalizeProgramOrganizers(['oss', 'OSS']).organizers).toEqual([
      'oss',
      'OSS',
    ]);
  });

  it.each([
    [[], 'REQUIRED', '주관기관을 1개 이상 입력해 주세요.'],
    [['   '], 'REQUIRED', '주관기관을 1개 이상 입력해 주세요.'],
    [
      Array.from({ length: 11 }, (_, index) => `기관 ${index}`),
      'TOO_MANY',
      '주관기관은 10개까지 입력할 수 있습니다.',
    ],
    [
      ['가'.repeat(51)],
      'TOO_LONG',
      '주관기관 이름은 50자 이하로 입력해 주세요.',
    ],
  ])('rejects %j with %s', (values, code, message) => {
    expect(normalizeProgramOrganizers(values).error).toEqual({
      field: 'organizers',
      code,
      message,
    });
  });

  it('accepts ten labels of fifty characters after trimming', () => {
    const values = Array.from(
      { length: 10 },
      (_, index) => ` ${String(index).padEnd(50, '가')} `,
    );
    expect(normalizeProgramOrganizers(values).error).toBeNull();
  });
});

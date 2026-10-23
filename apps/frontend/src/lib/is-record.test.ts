import { describe, expect, it } from 'vitest';
import { isRecord } from './is-record';

describe('isRecord', () => {
  it('일반 객체는 레코드로 인정한다', () => {
    expect(isRecord({ id: 'a' })).toBe(true);
  });

  it('프로토타입이 없는 객체도 레코드로 인정한다', () => {
    expect(isRecord(Object.create(null))).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['배열', [{ id: 'a' }]],
    ['빈 배열', []],
    ['문자열', 'text'],
    ['숫자', 1],
  ])('%s는 거부한다', (_label, input) => {
    expect(isRecord(input)).toBe(false);
  });
});
